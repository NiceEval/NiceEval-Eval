import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { assertReadOnlyHarness, prepareHarnessRepo } from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

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

    const turn = await t.send(`帮我看看 ${LOCATOR} 里 agent 实际是怎么实现缓存的。`);

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
