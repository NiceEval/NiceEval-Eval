import { defineEval } from "niceeval";
import { isFalse, isTrue, satisfies } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { assertNiceevalInstalled } from "../../lib/mechanism.ts";
import { saveAgentOutput } from "../../lib/agent-archive.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 DB-GPT（数据库对话式分析 + AWEL 工作流平台）。
 *
 * 仓库体积很大（完整 clone 接近 700MB，`docs/` 与 `assets/` 两个目录占了大头且与
 * 「装 niceeval」无关），所以用 sparse-checkout 剪掉。协议是
 * OpenAI Chat Completions 兼容形状（/v2/chat/completions），但 niceeval 没有对应内置件——
 * 兼容标准形状不等于零映射，仍然要手写 send。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/tutorials/quickstart.mdx",
];

const CORE_USE_CASE =
  "一个连着业务数据库的对话式数据分析 agent（DB-GPT）：问「这张表里销量最高的商品是什么」" +
  "应该返回具体的商品名并给出取数依据（查询了哪张表/哪个字段）；问数据源里不存在的表" +
  "应该明确答查不到，而不是编造结果";

const TRANSPORT = "HTTP POST /api/v2/chat/completions（OpenAI Chat Completions 兼容协议，Bearer API key 鉴权）";

export default defineEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "v0.8.1",
      excludeDirs: ["docs", "assets"],
    });

    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo, then finish the ` +
        `integration yourself — adapter, eval, and experiment. Nobody is available to confirm decisions with.\n\n` +
        `Then actually run your eval once, end to end — bring up whatever the integration needs so a real ` +
        `request reaches the system under test and a real response comes back — and confirm the result is ` +
        `viewable with \`niceeval show\`. A wired-up adapter that has never actually run once is not done.\n\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 第一层：检查 niceeval 是否安装好（gate）。四条接入路径共用同一套判定。 ──
    await assertNiceevalInstalled(t, { version });

    // ── 第二层：产出质量层（judge）。按维度分别判 agent 写出的三件套质量。 ──
    // 读 agent 写的三件套喂给 judge。两处坑：
    // 1) 老版本只喂 experiment + *.eval.ts，把 adapter 挡在门外——而「传输方式对不对」
    //    （进程内直调 / 启动被测进程 / 真发 HTTP）只在 adapter 里看得见，等于让 judge 蒙着眼
    //    判传输，把好 adapter 也误杀。所以要把 adapter 也喂进去。
    // 2) DB-GPT 的前端在 web/，老版本用 ignoreDirs 整个剪掉——但 DB-GPT 是 Python 宿主，
    //    web/ 恰好是仓库里唯一现成的 TS 工程，agent 会很自然地把 niceeval 装进 web/
    //    （实测就装在 web/agents、web/experiments、web/evals 下）。剪掉 web/ 等于把 agent
    //    自己的产出也一起剪没了，material 直接空。所以【不再】按目录剪 web/，改成按路径
    //    正向挑三件套：experiments/ 下、*.eval.ts、agents|adapters/ 下——既能捞到装进 web/
    //    的产出，又不会把 web/ 里 DB-GPT 前端那些 .ts 源码混进来。
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: DEFAULT_SOURCE_IGNORE_DIRS,
    });
    // 路径判定用「包含」而非「开头」，兼容 agent 把三件套装进子目录（web/ 或别的）的情况。
    const isEval = (p: string) => /\.eval\.ts$/.test(p);
    const isExperiment = (p: string) => /(^|\/)experiments\//.test(p);
    const isAdapter = (p: string) => /(^|\/)(agents?|adapters?)\//.test(p);
    const label = (files: (typeof src)[number][]) =>
      files.map((f) => `----- ${f.path} -----\n${f.content}`).join("\n\n") || "（无）";

    const experimentSource = label(src.filter((f) => isExperiment(f.path)));
    const evalSource = label(src.filter((f) => isEval(f.path)));
    // adapter/agent 层：agent 手写的 send 实现，通常落在 agents/ 或 adapters/ 下。
    // 这是「传输保真」唯一看得见的地方。正向挑，避免把宿主前端 .ts 扫进来。
    const adapterSource = label(src.filter((f) => isAdapter(f.path)));
    const material =
      `# experiment\n${experimentSource}\n\n# eval\n${evalSource}\n\n# adapter / 其它 agent 写的源码\n${adapterSource}`;

    // 老版本一条 closedQA 把「传输对不对 / 输入贴不贴业务 / 断言够不够具体」揉成一个二值
    // 判定，红了也说不清红在哪。改成按维度拆成多条各自可证伪的 judge：分数因此是分维度的
    // （更高级），且能直接倒查是哪一维塌了。每条都喂全量源码（含 adapter）。
    // 五个维度都用离线 judge-probe 对「理想好样本 / 占位 / 进程内直调 / 真传输弱断言 /
    // 一次真实 attempt 的产出」五类样本验证过，逐维判定与预期一致：理想样本全 1；进程内直调
    // 与占位在 transport 上判 0；真实那次（真发 HTTP+SSE 的 adapter、但 eval 只问「怎么用
    // CSV 分析」这类元问题、无负例）落在 0.60——transport/assertion/coupling=1，usecase/
    // negative=0，正是想要的分维度反馈，而不是一个说不清的二值。
    const DIMENSIONS: { key: string; threshold: number; criteria: string }[] = [
      {
        key: "传输保真",
        threshold: 0.7,
        criteria: `被测系统 DB-GPT 是一个独立运行的服务，agent 必须通过网络与它通信。它对外暴露 HTTP API，代表性端点是：${TRANSPORT}；但 agent 也可能选用 DB-GPT 其它等价的 HTTP 端点（如 /api/v1/chat/... 系列）——判据是「有没有真的走 DB-GPT 服务的 HTTP 接口」，不是「用了哪一个具体路径」。
判断：adapter（agent 手写的 send 实现）是否确实通过对 DB-GPT 服务发 HTTP 请求来通信，并把响应（含 SSE/stream 解帧）映射成 niceeval 的事件流？
合格（Y）：能看到向 DB-GPT 服务的某个 HTTP 端点发请求（fetch/POST 到 baseUrl 下的路径）、通常带 Authorization: Bearer、解析响应并产出文本/事件。/api/v2/chat/completions、/api/v1/chat/react-agent 等 DB-GPT 端点都算合格。
不合格（N）：adapter 进程内直接 import 并调用被测系统的 Python/函数；或在 adapter 里 spawn/启动被测系统进程；或根本没有对 DB-GPT 服务的网络请求。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写（一个具体的、与业务数据库相关的自然语言分析问题）？
不合格（N）：输入是 "hello" / "你好" / "test" / "帮我看看数据" 这类与具体业务无关的寒暄或占位内容。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了该问题应得到的具体结果，而不是只判跑通？
合格（Y）：断言检查回答里出现具体业务内容（商品名、取数依据的表名/字段名、具体数值等），用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「回答长度>0」「有回答」这类与内容无关的判定。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统连着真实数据库，最核心的风险是：问数据源里不存在的表/数据时，它会编造一个看似合理的结果而不是明确答查不到。
判断：eval 是否包含一条针对这个负例的用例——问不存在的表/数据，断言被测方明确答「查不到 / 不存在」且没有编造出具体结果？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 DB-GPT（数据库对话分析 agent），而不是各写各的、互不搭界？
不合格（N）：experiment 用的是 echoAgent / 通用占位 agent，或引用的 agent 与 eval 的被测系统看不出关联。`,
      },
    ];

    await t.group("产出质量层", async () => {
      // judge 是软分（severity=soft），不 gate verdict——只把「装好了但产出质量差」量化出来。
      // 每个维度各自套一层 group：judge 断言名固定是 judge:autoevals:closedQA，五条挤在一起
      // 无法区分，套上以维度命名的 group 后 report 里就成了「产出质量层 · 传输保真 · …」，
      // 哪一维塌了一眼可查。
      for (const d of DIMENSIONS) {
        await t.group(d.key, async () => {
          t.judge.autoevals.closedQA(d.criteria, { on: material }).atLeast(d.threshold);
        });
      }
    });

    // ── 第三层：动态验证层（软分，不 gate）。adapter 到底能不能真把一条 DB-GPT 回应拉回来。 ──
    // 静态 judge 只读代码、会被「看着像对」骗过；agent 自己写的断言又是自评（一句
    // t.succeeded() 就能糊弄）。这里改读 agent 内层那次真跑（niceeval exp）落盘的产物——
    // 独立看 events 里有没有一条带实质内容、从 DB-GPT 回来的 assistant 消息。
    // 起 DB-GPT 很重且波动大（见 lib/fixture-env.ts：uv sync 300MB+、要模型/DB/配置），
    // 所以这一层只作软分计量、不 gate：绿了说明 adapter 端到端通了、真验证了没写错；红了
    // 可能是没起服务、也可能是 adapter 写错，靠下面的 diagnostic 留证倒查，不拖垮 verdict。
    const cfgHit = (
      await t.sandbox.runShell(`find . -name niceeval.config.ts -not -path '*/node_modules/*' -maxdepth 3 | head -1`)
    ).stdout.trim();
    const at = cfgHit ? cfgHit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || "." : ".";

    // 在沙箱里扫 agent 内层 run 的落盘产物。events.json 是扁平 StreamEvent[]（见 niceeval
    // o11y/types.ts）：一条真实回应长这样 {type:"message",role:"assistant",text}；连不上则是
    // {type:"error",message:"Unable to reach…"}。用 heredoc 落一个 CJS 探针再跑，避免引号地狱。
    const probe = await t.sandbox.runShell(
      [
        `cat > /tmp/dbgpt-dyn-probe.cjs <<'PROBE'`,
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
        `node /tmp/dbgpt-dyn-probe.cjs`,
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
          `adapter 真的从 DB-GPT 收到过一条带内容的回应（实测 ${dyn.assistantWithText} 条；` +
            `连不上错误 ${dyn.connErr} 次）`,
        ).atLeast(1),
      );
      t.check(showSawContent, isTrue("niceeval show 能显示出跑过的结果内容").atLeast(1));
    });

    // adapter 没能真收到回应时留一条永久记录，供倒查是「没起 DB-GPT」还是「adapter 写错了」。
    if (dyn.assistantWithText < 1) {
      t.diagnostic({
        code: "adapter-no-live-response",
        level: "warning",
        message:
          `内层 run 没有一条来自 DB-GPT 的实质回应（assistant 消息 ${dyn.assistantWithText} 条，` +
          `连不上错误 ${dyn.connErr} 次，result 落盘 ${dyn.ranResults} 份）。` +
          `connErr>0 多半是没起 DB-GPT；全 0 且无回应则要查 adapter 是否根本没发出请求。`,
        data: dyn,
      });
    }

    // ── 第四层：路由层（计量，不 gate）。文档到底起没起作用。 ──────────
    const touched = bundledPagesTouched(t.events);

    await t.group("路由层", async () => {
      t.check(
        touchedIndex(t.events),
        isTrue(`以随包 INDEX.md 为路由入口（实际读到：${touched.join(", ") || "无"}）`).atLeast(1),
      );
      t.check(
        routedTo(t.events, EXPECTED_PAGES),
        isTrue(`读到与宿主形态匹配的页面（期望其一：${EXPECTED_PAGES.join(" | ")}）`).atLeast(1),
      );
      t.check(
        fellBackToOnlineDocs(t.events),
        isFalse("没有退回官网 / GitHub main 分支").atLeast(1),
      );
    });

    // 路由不理想时留一条永久记录，供事后按「哪一页没被读到」倒查文档。
    // 路由正常就不写——diagnostic 是用来记问题的，每次都写会把它变成噪声日志。
    if (!touchedIndex(t.events) || !routedTo(t.events, EXPECTED_PAGES)) {
      t.diagnostic({
        code: "routing-miss",
        level: "warning",
        message: `路由未命中期望页面。实际读到：${touched.join(", ") || "无"}`,
        data: { touched, expected: EXPECTED_PAGES },
      });
    }

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    // 沙箱马上就销毁，产物随之消失——趁现在抓一份。纯落盘，不影响 verdict。
    await saveAgentOutput(t, "db-gpt");

    turn.succeeded();
  },
});
