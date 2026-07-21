/**
 * install eval 第二/三层的共用件：产出质量层（分维度 judge）与动态验证层（真跑一次）。
 *
 * 抽出来是因为 db-gpt / gpt-researcher 两条接入路径判的「怎么算写得好」结构一致，只有
 * 各维度的判据文案（贴着各自被测系统写）不同。共用件保证两边不漂移；各 eval 只需给出
 * 自己的 DIMENSIONS 数组与被测系统名。
 */

import type { TestContext } from "niceeval";
import { isTrue, satisfies } from "niceeval/expect";
import { DEFAULT_SOURCE_IGNORE_DIRS } from "./fixture.ts";

/** 一个产出质量维度：一句可证伪的判据 + 阈值 + 报告里显示的维度名。 */
export interface QualityDimension {
  key: string;
  threshold: number;
  criteria: string;
}

// 「哪些是 agent 手写三件套」的路径判定。用「包含」而非「开头」，兼容 agent 把三件套
// 装进子目录（如 DB-GPT 的 web/）的情况。
const isEval = (p: string) => /\.eval\.ts$/.test(p);
const isExperiment = (p: string) => /(^|\/)experiments\//.test(p);
const isAdapter = (p: string) => /(^|\/)(agents?|adapters?)\//.test(p);

/**
 * 读全量 agent 源码，正向挑出三件套（experiment / eval / adapter），按路径标注后拼成
 * 一段喂给 judge 的材料。
 *
 * 两个坑（都栽过）：
 * 1) 必须把 adapter 也喂进去——「传输方式对不对」（进程内直调 / 启动被测进程 / 真发请求）
 *    只在 adapter 里看得见，只喂 experiment+eval 等于让 judge 蒙着眼判传输。
 * 2) 不能靠 ignoreDirs 把宿主前端目录（DB-GPT 的 web/、GPT Researcher 的 frontend/）整个剪掉：
 *    agent 常把 niceeval 就装进那个现成的 TS 工程里，剪掉等于把 agent 自己的产出也剪没了。
 *    所以按路径「正向挑」三件套，既能捞到装进子目录的产出，又不会把宿主前端 .ts 混进来。
 */
export async function readAgentSourceMaterial(t: TestContext): Promise<string> {
  const src = await t.sandbox.readSourceFiles({
    extensions: ["ts"],
    ignoreDirs: DEFAULT_SOURCE_IGNORE_DIRS,
  });
  const label = (files: (typeof src)[number][]) =>
    files.map((f) => `----- ${f.path} -----\n${f.content}`).join("\n\n") || "（无）";
  const experimentSource = label(src.filter((f) => isExperiment(f.path)));
  const evalSource = label(src.filter((f) => isEval(f.path)));
  const adapterSource = label(src.filter((f) => isAdapter(f.path)));
  return `# experiment\n${experimentSource}\n\n# eval\n${evalSource}\n\n# adapter / 其它 agent 写的源码\n${adapterSource}`;
}

/**
 * 产出质量层：把一条二值 closedQA 拆成多条各自可证伪的分维度 judge，分数因此是分维度的
 * （更高级），且能直接倒查是哪一维塌了。judge 是软分（severity=soft），不 gate verdict。
 *
 * 每个维度各自套一层以维度命名的 group：judge 断言名固定是 judge:autoevals:closedQA，
 * 五条挤在一起无法区分，套上后 report 里成了「产出质量层 · 传输保真 · …」，一眼可查。
 */
export async function runQualityDimensions(
  t: TestContext,
  material: string,
  dimensions: readonly QualityDimension[],
): Promise<void> {
  await t.group("产出质量层", async () => {
    for (const d of dimensions) {
      await t.group(d.key, async () => {
        t.judge.autoevals.closedQA(d.criteria, { on: material }).atLeast(d.threshold);
      });
    }
  });
}

/**
 * 动态验证层（软分，不 gate）：adapter 到底能不能真把一条被测系统的回应拉回来。
 *
 * 静态 judge 只读代码、会被「看着像对」骗过；agent 自己写的断言又是自评（一句
 * t.succeeded() 就能糊弄）。这里改读 agent 内层那次真跑（niceeval exp）落盘的产物——
 * 独立看 events 里有没有一条带实质内容、从被测系统回来的 assistant 消息。
 * 起被测系统很重且波动大（见 lib/fixture-env.ts），所以只作软分计量、不 gate：绿了说明
 * adapter 端到端通了、真验证了没写错；红了可能是没起服务、也可能是 adapter 写错，靠
 * diagnostic 留证倒查，不拖垮 verdict。
 *
 * @param systemName 被测系统名（如 "DB-GPT" / "GPT Researcher"），只用于断言/诊断文案。
 */
export async function assertAdapterRanLive(t: TestContext, systemName: string): Promise<void> {
  const cfgHit = (
    await t.sandbox.runShell(`find . -name niceeval.config.ts -not -path '*/node_modules/*' -maxdepth 3 | head -1`)
  ).stdout.trim();
  const at = cfgHit ? cfgHit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || "." : ".";

  // 在沙箱里扫 agent 内层 run 的落盘产物。events.json 是扁平 StreamEvent[]（见 niceeval
  // o11y/types.ts）：一条真实回应长这样 {type:"message",role:"assistant",text}；连不上则是
  // {type:"error",message:"Unable to reach…"}。用 heredoc 落一个 CJS 探针再跑，避免引号地狱。
  const probe = await t.sandbox.runShell(
    [
      `cat > /tmp/dyn-probe.cjs <<'PROBE'`,
      `const fs=require("fs"),cp=require("child_process");`,
      `const sh=c=>{try{return cp.execSync(c,{encoding:"utf8"});}catch(e){return (e.stdout||"")+(e.stderr||"");}};`,
      `const find=n=>sh("find . -path '*/.niceeval/*' -name "+n+" -not -path '*/node_modules/*' 2>/dev/null").split("\\n").map(s=>s.trim()).filter(Boolean);`,
      `const results=find("result.json"),eventFiles=find("events.json");`,
      `const CONN=/unable to reach|econnrefused|connection refused|start the app first|fetch failed|socket hang up|network error/i;`,
      `let assistantWithText=0,connErr=0;`,
      `for(const f of eventFiles){let a;try{a=JSON.parse(fs.readFileSync(f,"utf8"));}catch{continue;}if(!Array.isArray(a))continue;`,
      `  for(const e of a){if(e&&e.type==="message"&&e.role==="assistant"&&typeof e.text==="string"&&e.text.trim().length>=40)assistantWithText++;`,
      `    if(e&&e.type==="error"&&CONN.test(String(e.message||"")))connErr++;}}`,
      `console.log(JSON.stringify({ranResults:results.length,eventFiles:eventFiles.length,assistantWithText,connErr}));`,
      `PROBE`,
      `node /tmp/dyn-probe.cjs`,
    ].join("\n"),
    { cwd: at },
  );
  let dyn = { ranResults: 0, eventFiles: 0, assistantWithText: 0, connErr: 0 };
  try {
    dyn = JSON.parse(probe.stdout.trim().split("\n").pop() ?? "{}");
  } catch {
    // 探针输出解析不了就当作全 0——软分层，宁可漏报也不误崩整条 eval。
  }

  // agent 自己装的那个 CLI 能不能把跑出来的结果显示出来（niceeval show 看得到内容）。
  const show = await t.sandbox.runShell(`npx --no-install niceeval show --output ci 2>&1`, { cwd: at });
  const showSawContent =
    show.exitCode === 0 && /\b(passed|failed|errored)\b|@[a-z0-9]{6,}/i.test(show.stdout);

  await t.group("动态验证层", async () => {
    t.check(
      dyn.ranResults,
      satisfies((n) => (n as number) >= 1, "agent 真的把 eval 跑起来过（内层有 result 落盘）").atLeast(1),
    );
    t.check(
      dyn.assistantWithText,
      satisfies(
        (n) => (n as number) >= 1,
        `adapter 真的从 ${systemName} 收到过一条带内容的回应（实测 ${dyn.assistantWithText} 条；` +
          `连不上错误 ${dyn.connErr} 次）`,
      ).atLeast(1),
    );
    t.check(showSawContent, isTrue("niceeval show 能显示出跑过的结果内容").atLeast(1));
  });

  // adapter 没能真收到回应时留一条永久记录，供倒查是「没起服务」还是「adapter 写错了」。
  if (dyn.assistantWithText < 1) {
    t.diagnostic({
      code: "adapter-no-live-response",
      level: "warning",
      message:
        `内层 run 没有一条来自 ${systemName} 的实质回应（assistant 消息 ${dyn.assistantWithText} 条，` +
        `连不上错误 ${dyn.connErr} 次，result 落盘 ${dyn.ranResults} 份）。` +
        `connErr>0 多半是没起服务；全 0 且无回应则要查 adapter 是否根本没发出请求。`,
      data: dyn,
    });
  }
}
