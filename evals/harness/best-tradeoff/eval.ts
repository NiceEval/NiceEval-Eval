import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import {
  assertReadOnlyHarness,
  prepareHarnessRepo,
  SHOW_COMMAND_RE,
} from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EXPECTED_PAGES =
  /docs-site\/zh\/(?:how-to|tutorials)\/(?:viewing-results|experiments)\.mdx/;

export default defineEval({
  description: "[compare] 排除覆盖不完整的实验后，比较通过率与成本的综合权衡",
  tags: ["harness", "harness-v0.9.1", "compare"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send("compare 这些方案里哪个最划算？");

    await t.group("答案", async () => {
      t.check(t.reply, includes("compare/bub-gpt-5.6-luna--agents-md"));
      t.check(t.reply, includes("81.8%"));
      t.check(t.reply, includes("1.94"));
    });

    t.calledTool("shell", { input: { command: SHOW_COMMAND_RE } });
    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });
    assertReadOnlyHarness(t);
    turn.succeeded();
  },
});
