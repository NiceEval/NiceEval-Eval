import { defineEval } from "niceeval";
import { commandSucceeded, equals, satisfies } from "niceeval/expect";
import { assertPagesInCandidate } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import {
  EXP_COMMAND_RE,
  RAW_RESULT_RE,
  SHOW_COMMAND_RE,
  prepareLegacyProject,
  runInnerExperiment,
} from "./share/fixture.ts";

const EXPECTED_PAGES =
  /docs-site\/zh\/(tutorials\/(agent-feedback-loop|write-experiment)|reference\/define-agent)\.mdx/;

export default defineEval({
  description: "把可运行的 niceeval 0.9.1 项目长程迁移到当前候选，并跑完实验",
  timeoutMs: 25 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;
    assertPagesInCandidate(EXPECTED_PAGES, version);
    await prepareLegacyProject(t);

    const turn = await t.send(
      `这是一个可运行但仍固定在 niceeval@0.9.1 的旧项目。把它完整迁移到 niceeval@${version}：` +
        `升级依赖、重新执行 niceeval init，然后只根据升级后 node_modules/niceeval/INDEX.md 的随包文档` +
        `迁移旧 API（包括 adapter 和 experiment）。保留原评估语义，运行 local experiment，` +
        `用 niceeval show 核对到最终全绿。不要直接读取 .niceeval 原始 JSON，也不要用在线 main 文档。`,
    );

    const installedVersion = (
      await t.sandbox.runCommand("node", ["-p", "require('./node_modules/niceeval/package.json').version"])
    ).stdout.trim();
    const agentSource = await t.sandbox.readText("agents/policy.ts");
    const experimentSource = await t.sandbox.readText("experiments/local.ts");
    const confirmation = await runInnerExperiment(t, true);

    await t.group("迁移结果", async () => {
      t.check(installedVersion, equals(version));
      t.check(
        agentSource,
        satisfies(
          (v) => /defineDirectAgent/.test(String(v)) && /evidenceCoverage/.test(String(v)),
          "adapter 已迁到 defineDirectAgent 并声明 evidenceCoverage",
        ),
      );
      t.check(
        experimentSource,
        satisfies(
          (v) => /attempts\s*:\s*1/.test(String(v)) && !/\bruns\s*:/.test(String(v)),
          "experiment 已把 runs 迁到 attempts",
        ),
      );
      t.check(confirmation, commandSucceeded());
    });

    await t.group("迁移过程", async () => {
      t.sandbox.fileChanged("package.json");
      t.sandbox.fileChanged("agents/policy.ts");
      t.sandbox.fileChanged("experiments/local.ts");
      t.calledTool("shell", { input: { command: EXP_COMMAND_RE } });
      t.calledTool("shell", { input: { command: SHOW_COMMAND_RE } });
      t.notCalledTool("shell", { input: { command: RAW_RESULT_RE } });
    });

    await t.group("文档路由", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1);
    });

    turn.succeeded();
  },
});
