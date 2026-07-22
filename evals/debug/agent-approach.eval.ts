import { defineEval } from "niceeval";
import { includes, isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate } from "../../lib/candidate.ts";
import { prepareDebugSandbox, readRawJson } from "../../lib/debug-fixture.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";

/**
 * 深挖题:定位到失败的 attempt 之后,能不能靠 `niceeval show @<locator> --execution`
 * 读出 transcript 里的实际执行细节,而不是靠猜。
 *
 * transcript 里 agent 选了 unstable_cache 包一层 + revalidateTag('products','max'),
 * 而 gate 断言要的是 'use cache' 指令。中途唯一一次重试是 patch 上下文对不上导致的
 * 机械重打,方案本身自始至终没换过——「重试」与「改方案」是两回事,这是本题的考点。
 */

const EXPECTED_PAGES =
  /docs-site\/zh\/how-to\/viewing-results\.mdx|docs-site\/zh\/troubleshooting\/debugging\.mdx/;

const LOCATOR = "@1csayr61";
// 定位到这次 attempt 只是前提,本题真正考的是有没有展开执行事件流看 transcript
const EXECUTION_RE = /niceeval\s+show\s+@1csayr61\b[^\n]*--execution/;

export default defineEval({
  description: "[dig] 从失败 attempt 的执行事件流里,读出 agent 实际用的方案",
  tags: ["debug", "dig"],
  async test(t) {
    const version = t.flags.candidateVersion as string;

    assertPagesInCandidate(EXPECTED_PAGES, version);

    await prepareDebugSandbox(t);

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估,结果数据都在 .niceeval 里。

memory/agent-029-use-cache-directive 这条 eval 在 compare/codex-gpt-5.6-luna--agents-md 下
失败了,那次 attempt 的 locator 是 ${LOCATOR}。

请回答:那次 attempt 里,agent 实际用什么 API 实现缓存?它中途换过几次方案?

只查信息,不要修改任何文件,也不要重新运行任何实验。`,
    );

    await t.group("答案层", async () => {
      t.check(t.reply, includes("unstable_cache").gate());
      t.check(t.reply, includes("revalidateTag").gate());
    });

    // ── 命令调用链(gate)。本题给定了 locator,考的不是「能不能找到」,而是「能不能靠
    // --execution 展开执行事件流看 transcript」,而不是绕开它自己翻 .niceeval 原始 JSON。 ──
    await t.group("命令调用链", async () => {
      t.calledTool("shell", { input: { command: EXECUTION_RE } }).atLeast(1).gate();
      t.check(readRawJson(t.events), isFalse("没有徒手翻 .niceeval 原始 JSON").gate());
    });

    await t.group("路由层", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });

    t.check(t.sandbox.diff.isEmpty(), isTrue("没有改动 fixture 里的任何文件").atLeast(1));

    turn.succeeded();
  },
});
