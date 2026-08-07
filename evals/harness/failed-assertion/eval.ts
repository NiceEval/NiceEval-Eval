import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { assertReadOnlyHarness, prepareHarnessRepo } from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EVAL_ID = "memory/agent-029-use-cache-directive";
const EXP_ID = "compare/codex-gpt-5.6-luna--agents-md";
const LOCATOR = "@1csayr61";
const EXPECTED_PAGES =
  /docs-site\/zh\/(?:how-to|tutorials)\/viewing-results\.mdx|docs-site\/zh\/troubleshooting\/debugging\.mdx/;
const DISCOVERY_RE = new RegExp(`niceeval\\s+show\\b[^\\n]*(${EVAL_ID}|${EXP_ID})`);
const LOCATOR_RE = new RegExp(`niceeval\\s+show\\s+${LOCATOR}`);

export default defineEval({
  description: "[locate] 从 eval 与 experiment 定位失败断言及 attempt locator",
  tags: ["harness", "harness-v0.9.1", "locate"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(`看看 ${EVAL_ID} 在 ${EXP_ID} 里为什么失败了。`);

    t.check(t.reply, includes(LOCATOR));
    t.check(t.reply, includes("use cache"));
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
