import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { assertReadOnlyHarness, prepareHarnessRepo } from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EVAL_ID = "memory/agent-029-use-cache-directive";
const EXP_ID = "compare/codex-gpt-5.6-luna--agents-md";
const LOCATOR = "@1csayr61";
const EXPECTED_PAGES =
  /docs-site\/zh\/(?:how-to|tutorials)\/viewing-results\.mdx|docs-site\/zh\/troubleshooting\/debugging\.mdx/;
const EXECUTION_RE = new RegExp(`niceeval\\s+show\\s+${LOCATOR}\\b[^\\n]*--execution`);

export default defineEval({
  description: "[execution] 从执行事件流还原 agent 的实际实现方案与重试次数",
  tags: ["harness", "harness-v0.9.1", "execution"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估，历史结果都在 .niceeval 里。\n\n` +
        `${EVAL_ID} 在 ${EXP_ID} 下失败，那次 attempt 的 locator 是 ${LOCATOR}。` +
        `请回答：agent 实际用什么 API 实现缓存？它中途换过几次方案？\n\n` +
        `只查信息，不要修改文件，不要重新运行实验，也不要直接读取 .niceeval 原始 JSON。`,
    );

    t.check(t.reply, includes("unstable_cache"));
    t.check(t.reply, includes("revalidateTag"));
    t.check(
      t.reply,
      satisfies(
        (value) =>
          /0\s*次|没有(?:更换|改变|换过).*方案|方案(?:始终|一直).*没|方案.{0,20}(?:没有|未曾|没)(?:发生)?(?:更换|改变|变化)/.test(
            String(value),
          ),
        "明确说明没有更换实现方案",
      ),
    );
    t.calledTool("shell", { input: { command: EXECUTION_RE } });
    t.calledTool("shell", { input: { command: EXECUTION_RE }, output: /unstable_cache/ }).atLeast(1);
    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });
    assertReadOnlyHarness(t);
    turn.succeeded();
  },
});
