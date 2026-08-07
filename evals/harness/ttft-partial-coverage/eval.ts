import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import {
  assertReadOnlyHarness,
  prepareHarnessRepo,
  SHOW_COMMAND_RE,
} from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EXPECTED_PAGES =
  /docs-site\/zh\/(?:how-to|tutorials)\/viewing-results\.mdx|docs-site\/zh\/reference\/cli\.mdx/;
const DETAIL_RE = /niceeval\s+show\b[^\n]*(?:--execution|--timing)/;

export default defineEval({
  description: "[observability] 识别 TTFT 只覆盖部分 experiment，而不是补全缺失数据",
  tags: ["harness", "harness-v0.9.1", "observability", "boundary"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估，历史结果都在 .niceeval 里。\n\n` +
        `请回答：数据里能不能看到每次模型调用的首 token 延迟？如果能，哪些 experiment 有这个数据，` +
        `哪些没有？不要把只覆盖部分 experiment 的指标外推成全局结论。\n\n` +
        `只查信息，不要修改文件，不要重新运行实验，也不要直接读取 .niceeval 原始 JSON。`,
    );

    t.check(t.reply, includes("claude-dp-v4"));
    t.check(t.reply, includes("bub"));
    t.check(t.reply, includes("codex"));
    t.check(
      t.reply,
      satisfies(
        (value) => /没有|缺少|无此|未记录|未采集|看不到/.test(String(value)),
        "明确说明 bub/codex 组缺少 TTFT 证据",
      ),
    );
    t.calledTool("shell", { input: { command: SHOW_COMMAND_RE } });
    t.calledTool("shell", { input: { command: DETAIL_RE } }).atLeast(1);
    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });
    assertReadOnlyHarness(t);
    turn.succeeded();
  },
});
