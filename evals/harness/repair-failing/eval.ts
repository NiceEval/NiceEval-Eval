import { defineEval } from "niceeval";
import { commandSucceeded, includes, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../../lib/routing.ts";

const EXP_COMMAND_RE = /niceeval\s+exp\s+local\b/;
const SHOW_LOCATOR_RE = /niceeval\s+show\s+@[A-Za-z0-9]+\b/;

const EXPECTED_PAGES =
  /docs-site\/zh\/(tutorials\/(agent-feedback-loop|viewing-results)|troubleshooting\/debugging)\.mdx/;

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
  description: "两轮诊断断言失败，只修业务实现并重跑到通过",
  tags: ["harness", "harness-v0.12.0", "repair", "failed", "multi-turn"],
  timeoutMs: 20 * 60 * 1000,
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

    const diagnosis = await t.send("先看看 local experiment 为什么失败，暂时别改。");
    diagnosis.succeeded();
    const repair = await t.send("把它修好，再确认一下。");

    // 只读 agent 留下的结果；evaluator 不代替 agent 再运行一次 experiment。
    const green = await t.sandbox.runCommand("pnpm", [
      "--silent",
      "exec",
      "niceeval",
      "show",
      "--exp",
      "local",
      "--json",
    ]);
    await t.group("修复结果", async () => {
      t.check(green, commandSucceeded());
      t.check(green.stdout, satisfies(showReportsPassed, "agent 修复后的 local 结果为 passed"));
      t.sandbox.fileChanged("src/policy.ts");
      t.sandbox.notInDiff(/^(?:agents|evals|experiments)\/|^(?:niceeval\.config\.ts|package\.json)$/);
    });

    await t.group("调试路径", async () => {
      t.calledTool("shell", { input: { command: EXP_COMMAND_RE } }).atLeast(2);
      t.calledTool("shell", { input: { command: SHOW_LOCATOR_RE } });
    });

    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });

    t.check(await t.sandbox.readText("src/policy.ts"), includes("30 days"));
    repair.succeeded();
  },
});
