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
  tags: ["harness", "compare"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估，历史结果都在 .niceeval 里。\n\n` +
        `请回答：compare 组里哪个方案在成本和通过率上综合最优？给出 experiment id、通过率、` +
        `总成本，并说明你如何处理各组覆盖题数不同的问题。\n\n` +
        `只查信息，不要修改文件，不要重新运行实验，也不要直接读取 .niceeval 原始 JSON。`,
    );

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
