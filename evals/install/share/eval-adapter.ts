/**
 * 评估adapter（软分，不 gate）：agent 写的 adapter 有没有真联上被测系统。
 *
 * 只信 agent 自装的 CLI，不自己找/读 result.json——跑了几次不是这层关心的事（适配 live 系统
 * 的成本、稳不稳定各不相同，agent 跑几次都合理，不该被断言锁死），这里只看跑没跑通。
 * `niceeval show` 显示的 verdict 是 passed / failed 就说明请求真发出去、回应真回来，连不上会
 * 是 errored。起被测系统很重且波动大（见 lib/target-app-env.ts），所以只作软分计量、不 gate。
 *
 * 只被 db-gpt / gpt-researcher 两条 eval 调用。理由是**起被测系统的代价**，不是「任务没要求」
 * ——「真跑一次」本来就写在 INIT.md 的完成清单里（Actually run it once and get it green），
 * 五条路径都适用。但 Letta / Skyvern / OpenHands 要起的东西太重也太飘（Letta 要起服务、
 * Skyvern 还要拉浏览器、OpenHands 要起 app_server + sandbox 内的 agent server），断言它跑通
 * 测到的是环境波动而不是文档效果，所以那三条改用 judge 读 agent 手写的源码来评产出质量。
 *
 * 写法约定：判定一律用官方断言词汇，不发明领域 API；取证一律「一条命令或一个文件」。
 */

import type { ScoreTestContext } from "niceeval";
import { commandSucceeded, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./eval-install.ts";

/**
 * 评估adapter（软分，不 gate）：agent 写的 adapter 有没有真联上被测系统。
 * 见文件头注：只信 agent 自装的 CLI，不判跑了几次，只被两条 install eval 调用。
 */
export async function evalAdapter(t: ScoreTestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // 自装 CLI 能不能把跑出来的结果显示出来。show 没有 --output 这类 profile flag（两形态契约:
  // 不加 flag = 人读文本,非 TTY 自动降级为无框纯文本;--json 是机器面）,gate:show 尚未落地
  // --json,这里先用不带 flag 的默认人读文本;--json 落地后可把下面的字符串判定升级为结构化
  // 字段校验。
  const show = await sandbox.runShell(`npx --no-install niceeval show 2>&1`, { cwd: at });

  await t.group("评估adapter", async () => {
    t.check(show, commandSucceeded().atLeast(1));
    // 只要正向证据（出现 passed/failed = 请求真出去、回应真回来），不再排斥 errored 字样：
    // 「第一次跑挂、修好再跑通」是文件头明说合理的路径，历史里留着 errored 行不该连坐。
    // 连不上被测系统的 agent 本来就产不出任何 passed/failed。
    t.check(
      show.stdout,
      satisfies(
        (s) => /\b(passed|failed)\b/i.test(s as string),
        "niceeval show 显示的 verdict 有 passed/failed（真联上了被测系统；从没联上只会有 errored）",
      ).atLeast(1),
    );
  });
}
