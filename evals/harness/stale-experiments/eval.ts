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
  /docs-site\/zh\/(?:how-to|tutorials)\/viewing-results\.mdx|docs-site\/zh\/reference\/cli\.mdx/;

export default defineEval({
  description: "[overview] 找出结论过期的 experiment，并给出应执行的重跑命令",
  tags: ["harness", "harness-v0.9.1", "overview"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估，历史结果都在 .niceeval 里。\n\n` +
        `请回答：哪些 experiment 的当前结论已经过期，需要重跑？给出 NiceEval 建议的精确重跑命令。\n\n` +
        `只查信息，不要修改文件，不要实际重跑实验，也不要直接读取 .niceeval 原始 JSON。`,
    );

    await t.group("答案", async () => {
      t.check(t.reply, includes("compare/claude-dp-v4--nowledge"));
      t.check(t.reply, includes("compare/codex-gpt-5.6-luna--mempal"));
      t.check(t.reply, includes("compare/codex-gpt-5.6-luna--nowledge"));
      t.check(t.reply, includes("compare/claude-dp-v4--mempal"));
      t.check(t.reply, includes("niceeval exp compare/claude-dp-v4--mempal"));
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
