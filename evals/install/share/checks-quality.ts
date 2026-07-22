/**
 * install eval 的共用件：能动性层（真跑过一次吗）。
 *
 * 抽出来是因为 db-gpt / gpt-researcher 两条接入路径判的「adapter 有没有真联上被测系统」
 * 结构一致。写法约定同 ./checks-generic.ts 头注：官方断言词汇 + 「一条命令或一个文件」
 * 的探针，没有解析层、没有扫落盘的循环。
 *
 * 放在 evals/install/share/ 而不是顶层 lib/:判的是接入路径写出的 adapter 真跑没跑起来，
 * undo / debug 两组 eval 不接入、不写 adapter，用不上这条判据。
 *
 * 原来这里还有一层「产出质量层」（按维度拆开的 judge：传输保真/能力对准/用例贴合/断言具体/
 * 负例覆盖/实验-eval 耦合），已移除——judge 判据文案质量不稳定，两条接入路径各写一遍也
 * 没能收敛出可信的分维度信号，先拆掉，不留半成品在这里占位。
 */

import type { TestContext } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./checks-generic.ts";

/**
 * 能动性层（软分，不 gate）：agent 有没有真把自己写的东西跑起来、真联上被测系统。
 *
 * 联没联上不用自己取证：内层 runner 早就裁过了——读一份 attempt 的 result.json，
 * verdict 是 passed / failed（完成判定）就说明请求真发出去、回应真回来；连不上会是
 * errored。agent 自评能糊弄的是「回应好不好」（一句 t.succeeded() 的弱断言），这层不判——
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
