import { defineEval } from "niceeval";
import { includes, isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { prepareDebugSandbox, readRawJson, USE_CACHE_FAILURE } from "./share/fixture.ts";

/**
 * 定位题:能不能靠 `niceeval show` 一路钻到一次失败的 attempt,而不是绕开它自己翻
 * .niceeval 原始 JSON。题面只给「哪条 eval 在哪个 experiment 下失败」,不提断言内容——
 * 标准答案(locator、断言关键词 "use cache")由人工从签入的 .niceeval 数据核对,
 * evalId/expId/locator 定义在 share/fixture.ts,agent-approach 这条 eval 也在用同一份。
 */

const EXPECTED_PAGES =
  /docs-site\/zh\/troubleshooting\/debugging\.mdx|docs-site\/zh\/how-to\/viewing-results\.mdx/;

const { evalId, expId, locator } = USE_CACHE_FAILURE;

// 先钻到出问题的那一格:show 收窄到这条 eval 或这个 experiment
const DISCOVERY_RE = new RegExp(`niceeval\\s+show\\b[^\\n]*(${evalId}|${expId})`);

// 再钻到具体 attempt 看断言详情
const LOCATOR_RE = new RegExp(`niceeval\\s+show\\s+${locator}`);

export default defineEval({
  description: "[locate] 定位一次失败的断言与它的 attempt locator",
  tags: ["debug", "locate"],
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在,否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await prepareDebugSandbox(t);

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估,结果数据都在 .niceeval 里。

请回答:${evalId} 这条 eval 在 ${expId} 下失败了。它失败在哪条断言上?给出那次 attempt 的 locator。

只查信息,不要修改任何文件,也不要重新运行任何实验。`,
    );

    await t.group("答案层", async () => {
      t.check(t.reply, includes(locator).gate());
      t.check(t.reply, includes("use cache").gate());
    });

    // ── 命令调用链(gate)。这条 eval 评的核心就是这个:能不能正确调用 niceeval show
    // 定位到失败的那次 attempt,而不是翻 .niceeval 原始 JSON 硬凑答案。 ──
    await t.group("命令调用链", async () => {
      t.calledTool("shell", { input: { command: DISCOVERY_RE } }).atLeast(1).gate();
      t.calledTool("shell", { input: { command: LOCATOR_RE } }).atLeast(1).gate();
      t.check(readRawJson(t.events), isFalse("没有徒手翻 .niceeval 原始 JSON").gate());
    });

    // ── 路由层(计量,不 gate)。判据是碰过哪个路径、不是用了哪个工具。 ──
    await t.group("路由层", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1); // 读到与查询任务匹配的页面
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1); // 没退回官网 / GitHub main
    });

    // fixture 只读,改了文件说明它没听懂任务边界
    t.check(t.sandbox.diff.isEmpty(), isTrue("没有改动 fixture 里的任何文件").atLeast(1));

    turn.succeeded();
  },
});
