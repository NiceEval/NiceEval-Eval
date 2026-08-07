import { defineEval } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";
import {
  EXP_COMMAND_RE,
  SHOW_COMMAND_RE,
  prepareCurrentProject,
  runInnerExperiment,
} from "../share/fixture.ts";

const EXPECTED_PAGES =
  /docs-site\/zh\/tutorials\/(agent-feedback-loop|viewing-results|write-experiment)\.mdx/;

export default defineEval({
  description: "运行一个已接入的确定性实验，用 show 核对并准确汇报结果",
  tags: ["harness", "harness-v0.12.0", "run"],
  timeoutMs: 15 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareCurrentProject(t, new URL("./repo/", import.meta.url), version);

    const turn = await t.send("帮我跑一下 local experiment，看看结果。");

    const confirmation = await runInnerExperiment(t, true);
    await t.group("实验结果", async () => {
      t.check(confirmation, commandSucceeded());
      t.check(
        t.reply,
        satisfies((v) => /passed|通过/i.test(String(v)), "回复明确说明最终实验通过"),
      );
    });

    await t.group("反馈闭环", async () => {
      t.calledTool("shell", { input: { command: EXP_COMMAND_RE } });
      t.calledTool("shell", { input: { command: SHOW_COMMAND_RE } });
    });

    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });

    t.check(t.sandbox.diff.isEmpty(), isTrue("没有修改已经可运行的项目"));
    turn.succeeded();
  },
});
