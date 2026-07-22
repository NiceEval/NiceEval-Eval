/**
 * 评估adapter（软分，不 gate）：agent 写的 adapter 有没有真联上被测系统。
 *
 * 只信 agent 自装的 CLI，不自己找/读 result.json——跑了几次不是这层关心的事（适配 live 系统
 * 的成本、稳不稳定各不相同，agent 跑几次都合理，不该被断言锁死），这里只看跑没跑通。
 * `niceeval show` 显示的 verdict 是 passed / failed 就说明请求真发出去、回应真回来，连不上会
 * 是 errored。起被测系统很重且波动大（见 lib/target-app-env.ts），所以只作软分计量、不 gate。
 *
 * 只被 db-gpt / gpt-researcher 两条 install eval 调用——undo 组三条 eval 的任务描述没有要求
 * agent「真跑一次」，调这个函数会断言一件任务里没提过的事。
 *
 * 写法约定：判定一律用官方断言词汇，不发明领域 API；取证一律「一条命令或一个文件」。
 */

import type { TestContext } from "niceeval";
import { commandSucceeded, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./eval-install.ts";

/**
 * 评估adapter（软分，不 gate）：agent 写的 adapter 有没有真联上被测系统。
 * 见文件头注：只信 agent 自装的 CLI，不判跑了几次，只被两条 install eval 调用。
 */
export async function evalAdapter(t: TestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // 自装 CLI 能不能把跑出来的结果显示出来
  const show = await sandbox.runShell(`npx --no-install niceeval show --output ci 2>&1`, { cwd: at });

  await t.group("评估adapter", async () => {
    t.check(show, commandSucceeded().atLeast(1));
    t.check(
      show.stdout,
      satisfies(
        (s) => /\b(passed|failed)\b/i.test(s as string) && !/\berrored\b/i.test(s as string),
        "niceeval show 显示的 verdict 是 passed/failed（真联上了被测系统；连不上会是 errored）",
      ).atLeast(1),
    );
  });
}
