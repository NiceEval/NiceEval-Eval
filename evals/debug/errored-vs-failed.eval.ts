import { defineEval } from "niceeval";
import { includes, isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { prepareDebugSandbox, readRawJson } from "./share/fixture.ts";

/**
 * 定位题:区分「断言失败」与「基础设施出错」这两类不同的问题。
 *
 * 8 个 errored 全是 error.code=turn-failed / phase=eval.run,上游网关返回
 * 503(7 个)与 429(@1p3fanrj)——基础设施错误,不是断言失败。codex--mempal 与
 * codex--nowledge 两组是整组 errored(0% 通过率里一条 failed 都没有)。
 */

const EXPECTED_PAGES =
  /docs-site\/zh\/troubleshooting\/debugging\.mdx|docs-site\/zh\/troubleshooting\/debug-sandbox\.mdx/;

// 先钻到出问题的那两组 experiment
const DISCOVERY_RE = /niceeval\s+show\b[^\n]*compare\/codex-gpt-5\.6-luna--(mempal|nowledge)/;
// 再钻到具体某次 attempt 看报错详情,而不是只读汇总视图里的通过率数字
const LOCATOR_RE = /niceeval\s+show\s+@[a-z0-9]{6,}/;

export default defineEval({
  description: "[locate] 区分 errored 与 failed,定位 errored 的直接原因",
  tags: ["debug", "locate"],
  async test(t) {
    const version = t.flags.candidateVersion as string;

    assertPagesInCandidate(EXPECTED_PAGES, version);

    await prepareDebugSandbox(t);

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估,结果数据都在 .niceeval 里。

请回答:有哪些 attempt 是 errored 而不是 failed?errored 的直接原因是什么?

只查信息,不要修改任何文件,也不要重新运行任何实验。`,
    );

    await t.group("答案层", async () => {
      t.check(t.reply, includes("turn-failed").gate());
      t.check(t.reply, includes("503").gate());
      t.check(t.reply, includes("compare/codex-gpt-5.6-luna--mempal").gate());
      t.check(t.reply, includes("compare/codex-gpt-5.6-luna--nowledge").gate());
    });

    // ── 命令调用链(gate)。errored 的原因不会出现在汇总视图的通过率数字里——必须
    // 钻到具体某次 attempt 才能看到 error.code / 网关状态码,而不是靠猜或翻原始 JSON。 ──
    await t.group("命令调用链", async () => {
      t.calledTool("shell", { input: { command: DISCOVERY_RE } }).atLeast(1).gate();
      t.calledTool("shell", { input: { command: LOCATOR_RE } }).atLeast(1).gate();
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
