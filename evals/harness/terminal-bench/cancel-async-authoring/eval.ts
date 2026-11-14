import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { pullInnerNodeImage, pullInnerPythonImage } from "../../../../lib/sandbox.ts";

import { changedFixtureFiles, loadFixtureFiles } from "../../../../lib/fixture-files.ts";
import { currentVerdicts, query, runOnce, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const TARGET_EVAL = "evals/terminal-bench/cancel-async-tasks.eval.ts";
const OFFICIAL_TESTS = "task/tests/test_outputs.py";
const FIXTURE = new URL("../../../../fixtures/harness/terminal-bench/cancel-async-authoring/repo/", import.meta.url);

// 官方题包：题面、Dockerfile、runner、参考答案与两份测试。
const taskAssets = new Map([...loadFixtureFiles(FIXTURE)].filter(([path]) => path.startsWith("task/")));
const originalOfficialTests = taskAssets.get(OFFICIAL_TESTS);
if (originalOfficialTests === undefined) throw new Error(`fixture 缺少 ${OFFICIAL_TESTS}`);

export default defineScoreEval({
  description: "把真实 Terminal-Bench 题包接成不泄漏判据、带正反控制的正式 Eval",
  tags: ["harness", "harness-v2", "terminal-bench", "authoring", "hidden-tests", "deterministic", "single-turn"],
  timeoutMs: 30 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(pullInnerNodeImage).before(pullInnerPythonImage).before(uploadDirectory({
    id: "fixture",
    source: FIXTURE,
    to: ".",
  })),
  async test(t) {
    // 真实用户只说要什么；隐藏判据、指纹和不改题包，都应由随包文档和 agent 的判断补上。
    const input = `把 task/ 这道 Terminal-Bench 题写成 ${TARGET_EVAL}，用官方 tests 判分。写好后用 oracle 和 leak-probe 各跑一次，告诉我结果。`;
    const turn = await t.send(input);
    const shell: Shell = (script) => t.sandbox.runShell(script);
    // 先读 agent 自己跑出的结果，外层探针运行之后这些结果会被覆盖。
    const student = {
      oracle: currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "oracle" })),
      "leak-probe": currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "leak-probe" })),
    };
    t.log(JSON.stringify({ rubric: "harness-v2", student }));
    t.check(student, equals({
      oracle: { "terminal-bench/cancel-async-tasks": "passed" },
      "leak-probe": { "terminal-bench/cancel-async-tasks": "failed" },
    })).key("harness.cancel-async-authoring.student-runs").label("Agent 自己完成正反运行（外层验收不补此事实）");

    turn.succeeded()
      .key("harness.cancel-async-authoring.turn-succeeded")
      .label("Eval authoring Turn 成功");
    turn.notCalledTool(
      readsPrivateRecord,
    )
      .key("harness.cancel-async-authoring.no-private-record")
      .label("未读取 .niceeval 私有结果");

    t.sandbox.changedPaths([TARGET_EVAL])
      .score(1)
      .key("harness.cancel-async-authoring.target-only")
      .label("只创建目标 Eval");

    t.check(await changedFixtureFiles(t.sandbox, taskAssets), equals([]))
      .score(2)
      .key("harness.cancel-async-authoring.assets-unchanged")
      .label("官方题面、判据与参考答案保持原样");

    const dry = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "oracle", "--dry"],
    );
    t.check(dry, commandSucceeded())
      .score(2)
      .key("harness.cancel-async-authoring.discovery")
      .label("目标 Eval 可发现并可完成 link plan");

    const expectPassed = { "terminal-bench/cancel-async-tasks": "passed" };
    const expectFailed = { "terminal-bench/cancel-async-tasks": "failed" };
    const oracle = await runOnce(shell, ["oracle", "--rerun", "all"]);
    t.log(JSON.stringify({ outerProbe: "oracle", ...oracle }));
    t.check({ exitCode: oracle.exitCode, results: oracle.results }, equals({ exitCode: 0, results: expectPassed }))
      .score(6).key("harness.cancel-async-authoring.oracle-passes")
      .label("官方参考实现通过完整官方判据");

    try {
      await t.sandbox.writeText(OFFICIAL_TESTS,
        `${originalOfficialTests}\n# Harness fingerprint probe: behavior intentionally unchanged.\n`);
      // No rerun flag: this specifically tests criteria invalidation.
      const fingerprint = await runOnce(shell, ["oracle"]);
      t.log(JSON.stringify({ outerProbe: "fingerprint", ...fingerprint }));
      // Score invalidation separately: a fresh attempt that times out still proves
      // the old result was not reused. Keep its completion status visible below.
      t.check(fingerprint.actions, equals(["executed"]))
        .score(2).key("harness.cancel-async-authoring.criteria-fingerprint")
        .label("隐藏判据变化会自动作废旧结果");
      t.check({ exitCode: fingerprint.exitCode, results: fingerprint.results }, equals({ exitCode: 0, results: expectPassed }))
        .key("harness.cancel-async-authoring.fingerprint-probe-completed")
        .label("无行为变化的判据探针运行完成且参考实现仍通过");

      const leak = await runOnce(shell, ["leak-probe", "--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "leak-probe", ...leak }));
      t.check({ exitCode: leak.exitCode, results: leak.results }, equals({ exitCode: 1, results: expectFailed }))
        .score(3).key("harness.cancel-async-authoring.leak-probe-fails")
        .label("未见隐藏材料的负向探针保持 ordinary failed");

      // Independent mutation catches skipped tests and ignored verifier exit codes.
      await t.sandbox.writeText(OFFICIAL_TESTS,
        `${originalOfficialTests}\n\ndef test_harness_verifier_must_execute():\n    assert False, "outer harness verifier sentinel"\n`);
      const sentinel = await runOnce(shell, ["oracle", "--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "verifier-sentinel", ...sentinel }));
      t.check({ exitCode: sentinel.exitCode, results: sentinel.results }, equals({ exitCode: 1, results: expectFailed }))
        .score(2).key("harness.cancel-async-authoring.verifier-enforced")
        .label("真实测试新增失败会使 oracle ordinary failed，而非忽略退出码");
    } finally {
      await t.sandbox.writeText(OFFICIAL_TESTS, originalOfficialTests);
    }
  },
});
