import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";
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
  description: "[boundary] 结果未采集资源指标时，应明确说查不到而不是编造数字",
  tags: ["harness", "harness-v0.9.1", "boundary"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send("各个 experiment 跑的时候用了多少内存和 CPU？");

    t.check(
      t.reply,
      satisfies(
        (value) => /没有(?:记录|采集|提供)|未(?:记录|采集|提供)|看不到|查不到|无法(?:从|确定|得出)/.test(String(value)),
        "明确说明历史结果没有资源指标",
      ),
    );
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
