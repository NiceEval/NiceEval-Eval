import { defineEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";
import {
  EXP_COMMAND_RE,
  RAW_RESULT_RE,
  SHOW_LOCATOR_RE,
  prepareCurrentProject,
  runInnerExperiment,
} from "../share/fixture.ts";

const EXPECTED_PAGES =
  /docs-site\/zh\/(tutorials\/(agent-feedback-loop|viewing-results)|troubleshooting\/debugging)\.mdx/;

export default defineEval({
  description: "首次运行必失败：用 locator 调试，只修被测代码并自迭代到全绿",
  tags: ["harness", "harness-v0.12.0", "repair"],
  timeoutMs: 20 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareCurrentProject(t, new URL("./repo/", import.meta.url), version);

    const red = await runInnerExperiment(t, true);
    if (red.exitCode !== 1) {
      throw new Error(
        `预置实验没有按设计失败（预期 exit 1，实际 ${red.exitCode}）：\n${red.stderr || red.stdout}`,
      );
    }

    const turn = await t.send(
      `这个仓库的 local experiment 有一个确定性回归，首次运行必然失败。先读 ` +
        `node_modules/niceeval/INDEX.md 与反馈闭环/调试文档；用 --rerun all 复现，从输出 locator ` +
        `执行 niceeval show @<locator> 下钻证据。只能修 src/policy.ts，不许改 agents、evals、` +
        `experiments 或断言；持续局部重跑直到全绿，最后再 show 核对。不要直接读 .niceeval JSON。`,
    );

    const green = await runInnerExperiment(t, true);
    await t.group("修复结果", async () => {
      t.check(green, commandSucceeded());
      t.sandbox.fileChanged("src/policy.ts");
      t.sandbox.notInDiff(/^(?:agents|evals|experiments)\/|^(?:niceeval\.config\.ts|package\.json)$/);
    });

    await t.group("调试路径", async () => {
      t.calledTool("shell", { input: { command: EXP_COMMAND_RE } });
      t.calledTool("shell", { input: { command: SHOW_LOCATOR_RE } });
      t.notCalledTool("shell", { input: { command: RAW_RESULT_RE } });
    });

    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });

    t.check(await t.sandbox.readText("src/policy.ts"), includes("30 days"));
    turn.succeeded();
  },
});
