import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { assertReadOnlyHarness, prepareHarnessRepo } from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EXPECTED_PAGES =
  /docs-site\/zh\/troubleshooting\/(?:debugging|debug-sandbox)\.mdx/;
const DISCOVERY_RE =
  /niceeval\s+show\b[^\n]*compare\/codex-gpt-5\.6-luna--(?:mempal|nowledge)/;
const LOCATOR_RE = /niceeval\s+show\s+@[a-z0-9]{6,}/;

export default defineEval({
  description: "[status] 区分 errored 与 failed，并定位基础设施错误的直接原因",
  tags: ["harness", "harness-v0.9.1", "status", "locate"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估，历史结果都在 .niceeval 里。\n\n` +
        `请回答：哪些 experiment 出现了 errored，哪些是整组 errored？一共有多少个 errored attempt？` +
        `它们和 failed 有什么区别，直接原因分别是什么？\n\n` +
        `只查信息，不要修改文件，不要重新运行实验，也不要直接读取 .niceeval 原始 JSON。`,
    );

    await t.group("答案", async () => {
      t.check(t.reply, includes("turn-failed"));
      t.check(t.reply, includes("503"));
      t.check(t.reply, includes("429"));
      t.check(t.reply, includes("compare/codex-gpt-5.6-luna--mempal"));
      t.check(t.reply, includes("compare/codex-gpt-5.6-luna--nowledge"));
      t.check(
        t.reply,
        satisfies(
          (value) => /(?:共\s*)?8\s*(?:个|次)/.test(String(value)),
          "明确报告 8 个 errored attempt",
        ),
      );
    });

    t.calledTool("shell", { input: { command: DISCOVERY_RE } });
    t.calledTool("shell", { input: { command: LOCATOR_RE } });
    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });
    assertReadOnlyHarness(t);
    turn.succeeded();
  },
});
