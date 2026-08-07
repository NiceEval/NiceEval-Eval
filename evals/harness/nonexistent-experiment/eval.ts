import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { assertReadOnlyHarness, prepareHarnessRepo } from "../../../lib/harness-repo.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const MISSING_EXP = "compare/bub-gpt-5.6-luna--mempal";
const EXPECTED_PAGES =
  /docs-site\/zh\/(?:how-to|tutorials)\/viewing-results\.mdx|docs-site\/zh\/reference\/cli\.mdx/;
const LOOKUP_RE = new RegExp(`niceeval\\s+show\\b[^\\n]*${MISSING_EXP}`);

export default defineEval({
  description: "[boundary] experiment 名称看似符合规律但不存在时，应拒绝补全通过率",
  tags: ["harness", "harness-v0.9.1", "boundary"],
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareHarnessRepo(t, new URL("./repo/", import.meta.url));

    const turn = await t.send(
      `这个项目已经用 niceeval 跑过评估，历史结果都在 .niceeval 里。\n\n` +
        `请回答：${MISSING_EXP} 这组的通过率是多少？如果这组不存在，请明确说明，不要按其它命名规律补全。\n\n` +
        `只查信息，不要修改文件，不要重新运行实验，也不要直接读取 .niceeval 原始 JSON。`,
    );

    t.check(
      t.reply,
      satisfies(
        (value) => {
          const reply = String(value);
          const asserted = reply.replace(
            /(?:不是|并非|不能说是|不应(?:当作|视为))\s*\d+(?:\.\d+)?\s*%/g,
            "",
          );
          return /不存在|没有(?:这个|找到|该)|查无|无结果/.test(reply) &&
            !/\d+(?:\.\d+)?\s*%/.test(asserted);
        },
        "明确说明 experiment 不存在，且没有编造通过率",
      ),
    );
    t.calledTool("shell", { input: { command: LOOKUP_RE } });
    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });
    assertReadOnlyHarness(t);
    turn.succeeded();
  },
});
