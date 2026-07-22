/**
 * install eval 的共用件：能动性层（真跑过一次吗）与产出质量层（分维度 judge）。
 *
 * 抽出来是因为 db-gpt / gpt-researcher 两条接入路径判的「怎么算写得好」结构一致，只有
 * 各维度的判据文案（贴着各自被测系统写）不同。写法约定同 ./checks-generic.ts 头注：
 * 官方断言词汇 + 「一条命令或一个文件」的探针，没有解析层、没有扫落盘的循环。
 *
 * 放在 evals/install/share/ 而不是顶层 lib/:「产出质量层」判的是接入路径写出的三件套
 * 好不好，undo / debug 两组 eval 不接入、不产出三件套，用不上这套判据。
 */

import type { TestContext } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./checks-generic.ts";
import { DEFAULT_SOURCE_IGNORE_DIRS } from "./fixture.ts";

/** 一个产出质量维度：一句可证伪的判据 + 阈值 + 报告里显示的维度名。 */
export interface QualityDimension {
  key: string;
  threshold: number;
  criteria: string;
}

/**
 * 产出质量层：把一条二值 closedQA 拆成多条各自可证伪的分维度 judge，分数因此是分维度的
 * （更高级），且能直接倒查是哪一维塌了。judge 是软分（severity=soft），不 gate verdict。
 *
 * 每个维度各自套一层以维度命名的 group：judge 断言名固定是 judge:autoevals:closedQA，
 * 五条挤在一起无法区分，套上后 report 里成了「产出质量层 · 传输保真 · …」，一眼可查。
 *
 * 判据材料的两条铁律（真实产出栽过的坑）：① 必须含 adapter——「传输方式对不对」
 * （进程内直调 / spawn 被测进程 / 真发请求）只在 adapter 里看得见；② 按路径正向挑
 * 三件套、不靠 ignoreDirs 剪宿主目录——agent 常把 niceeval 装进宿主前端工程（如
 * DB-GPT 的 web/），剪掉等于把 agent 自己的产出也剪没。
 */
export async function runQualityDimensions(
  t: TestContext,
  dimensions: readonly QualityDimension[],
): Promise<void> {
  const src = await t.sandbox.readSourceFiles({
    extensions: ["ts"],
    ignoreDirs: DEFAULT_SOURCE_IGNORE_DIRS,
  });
  const material = src
    .filter((f) => /(^|\/)experiments\/|(^|\/)(agents?|adapters?)\/|\.eval\.ts$/.test(f.path))
    .map((f) => `----- ${f.path} -----\n${f.content}`)
    .join("\n\n");

  await t.group("产出质量层", async () => {
    for (const d of dimensions) {
      await t.group(d.key, async () => {
        t.judge.autoevals.closedQA(d.criteria, { on: material }).atLeast(d.threshold);
      });
    }
  });
}

/**
 * 能动性层（软分，不 gate）：agent 有没有真把自己写的东西跑起来、真联上被测系统。
 *
 * 联没联上不用自己取证：内层 runner 早就裁过了——读一份 attempt 的 result.json，
 * verdict 是 passed / failed（完成判定）就说明请求真发出去、回应真回来；连不上会是
 * errored。agent 自评能糊弄的是「回应好不好」（一句 t.succeeded() 的弱断言），那归
 * 产出质量层的 judge 管，不在这层重复判。
 * 起被测系统很重且波动大（见 lib/target-app-env.ts），所以只作软分计量、不 gate。
 */
export async function assertAdapterRanLive(t: TestContext): Promise<void> {
  const at = (await locateInstallRoot(t.sandbox)) ?? ".";

  // 定位一份 attempt 落盘（品味层要求 runs=1，内层通常恰好一个 attempt）
  const hit = (
    await t.sandbox.runShell(
      `find . -path '*/.niceeval/*' -name result.json -not -path '*/node_modules/*' | head -1`,
    )
  ).stdout.trim();
  // 本层唯一读的文件：那份 result.json
  const result = hit ? await t.sandbox.readFile(hit.replace(/^\.\//, "")).catch(() => "") : "";
  // 自装 CLI 能不能把跑出来的结果显示出来
  const show = await t.sandbox.runShell(`npx --no-install niceeval show --output ci 2>&1`, { cwd: at });

  await t.group("能动性层", async () => {
    t.check(hit.length > 0, isTrue("agent 真的把 eval 跑起来过（内层有 attempt 落盘）").atLeast(1));
    t.check(
      result,
      satisfies(
        (s) => /"verdict"\s*:\s*"(passed|failed)"/.test(s as string),
        "attempt 完成判定＝真联上了被测系统（连不上会是 errored）",
      ).atLeast(1),
    );
    t.check(show, commandSucceeded().atLeast(1));
    t.check(
      show.stdout,
      satisfies(
        (s) => /\b(passed|failed|errored)\b|@[a-z0-9]{6,}/i.test(s as string),
        "niceeval show 能显示出跑过的结果内容",
      ).atLeast(1),
    );
  });
}
