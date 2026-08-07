import { defineEval } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EXP_COMMAND_RE = /niceeval\s+exp\s+local\b/;
const SHOW_COMMAND_RE = /niceeval\s+show\b/;

const EXPECTED_PAGES =
  /docs-site\/zh\/tutorials\/(agent-feedback-loop|viewing-results|write-experiment)\.mdx/;

function showReportsPassed(value: unknown): boolean {
  try {
    const report = JSON.parse(String(value)) as {
      format?: string;
      data?: {
        summary?: {
          attempts?: number;
          attemptVerdicts?: { passed?: number; failed?: number; errored?: number };
        };
      };
    };
    const summary = report.data?.summary;
    return (
      report.format === "niceeval.show" &&
      summary?.attempts === 1 &&
      summary.attemptVerdicts?.passed === 1 &&
      summary.attemptVerdicts.failed === 0 &&
      summary.attemptVerdicts.errored === 0
    );
  } catch {
    return false;
  }
}

export default defineEval({
  description: "自行运行并确认一个确定性绿色 experiment",
  tags: ["harness", "harness-v0.12.0", "run"],
  timeoutMs: 15 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await t.sandbox.uploadDirectory(new URL("./repo/", import.meta.url));
    const materialize = await t.sandbox.runShell(
      "find . -type f -name '*.fixture' -exec sh -c 'for source_file do mv \"$source_file\" \"${source_file%.fixture}\"; done' sh {} +",
    );
    if (materialize.exitCode !== 0) throw new Error(materialize.stderr || materialize.stdout);
    const install = await t.sandbox.runCommand("pnpm", ["add", "-D", `niceeval@${version}`]);
    if (install.exitCode !== 0) throw new Error(install.stderr || install.stdout);
    const init = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "init"]);
    if (init.exitCode !== 0) throw new Error(init.stderr || init.stdout);

    const turn = await t.send("帮我跑一下 local experiment，看看结果。");

    // 只读 agent 留下的结果；evaluator 不代替 agent 再运行一次 experiment。
    const confirmation = await t.sandbox.runCommand("pnpm", [
      "--silent",
      "exec",
      "niceeval",
      "show",
      "--exp",
      "local",
      "--json",
    ]);
    await t.group("实验结果", async () => {
      t.check(confirmation, commandSucceeded());
      t.check(
        confirmation.stdout,
        satisfies(showReportsPassed, "agent 产生的 local 最终结果为 passed"),
      );
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
