import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, referencesAnyPath, toolMatch } from "niceeval/expect";
import { loadCriteria, loadText } from "niceeval/loaders";
import { changeFrequency, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { exp, query, type Shell } from "../../../../lib/query.ts";

const GIB = 1024 ** 3;

const TARGET_EVAL = "evals/terminal-bench/cancel-async-tasks.eval.ts";
const FIXTURE_ROOT = "../../../../fixtures/harness/terminal-bench/cancel-async-authoring/repo/";
const PROTECTED_ASSETS = [
  "task/task.yaml",
  "task/fixture/Dockerfile",
  "task/run-tests.sh",
  "task/solution.sh",
  "task/tests/test.py",
  "task/tests/test_outputs.py",
] as const;

await loadCriteria({ pattern: `${FIXTURE_ROOT}**/*`, relativeTo: new URL(import.meta.url) });

const protectedContents = await Promise.all(
  PROTECTED_ASSETS.map(async (path) => [
    path,
    await loadText(new URL(`${FIXTURE_ROOT}${path}`, import.meta.url)),
  ] as const),
);

export default defineScoreEval({
  description: "把真实 Terminal-Bench 题包接成不泄漏判据、带正反控制的正式 Eval",
  tags: ["harness", "harness-v2", "terminal-bench", "authoring", "hidden-tests", "deterministic", "single-turn"],
  timeoutMs: 30 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({
    docker: {
      api: "docker/v1",
      compose: "v2",
      isolation: "dedicated-kernel/v1",
      minimumDataBytes: 4 * GIB,
    },
  }).before(uploadDirectory({
    id: "niceeval-eval.harness.cancel-async-authoring.fixture",
    source: new URL(FIXTURE_ROOT, import.meta.url),
    to: ".",
    changeFrequency: changeFrequency.normal,
  })),
  async test(t) {
    // 像真实用户一样只交代目标与硬约束；隐藏判据怎么接、指纹怎么进，由随包文档引导。
    const input = `task/ 里是我从 Terminal-Bench 拿来的 cancel-async-tasks 题，还没接进 NiceEval。
帮我把它写成 ${TARGET_EVAL}，用官方 tests 判分。tests 和 solution 是答案，别让被测 agent 看到；task/、agents/、experiments/ 里的文件别改。
写好后用 oracle 和 leak-probe 两个 experiment 各跑一次，告诉我结果。`;
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
      toolMatch({ input: referencesAnyPath([".niceeval"]) }),
    )
      .key("harness.cancel-async-authoring.no-private-record")
      .label("未读取 .niceeval 私有结果");

    t.sandbox.changedPaths([TARGET_EVAL])
      .score(1)
      .key("harness.cancel-async-authoring.target-only")
      .label("只创建目标 Eval");

    const changedAssets: string[] = [];
    for (const [path, expected] of protectedContents) {
      if ((await t.sandbox.readText(path).catch(() => undefined)) !== expected) changedAssets.push(path);
    }
    t.check(changedAssets, equals([]))
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
    const oracle = await inspect(shell, ["oracle", "--rerun", "all"]);
    t.log(JSON.stringify({ outerProbe: "oracle", ...oracle }));
    t.check({ exitCode: oracle.exitCode, results: oracle.results }, equals({ exitCode: 0, results: expectPassed }))
      .score(6).key("harness.cancel-async-authoring.oracle-passes")
      .label("官方参考实现通过完整官方判据");

    const officialTestsPath = "task/tests/test_outputs.py";
    const originalOfficialTests = protectedContents.find(([path]) => path === officialTestsPath)?.[1];
    if (originalOfficialTests === undefined) throw new Error("fixture 缺少官方测试");
    try {
      await t.sandbox.writeText(officialTestsPath,
        `${originalOfficialTests}\n# Harness fingerprint probe: behavior intentionally unchanged.\n`);
      // No rerun flag: this specifically tests criteria invalidation.
      const fingerprint = await inspect(shell, ["oracle"]);
      t.log(JSON.stringify({ outerProbe: "fingerprint", ...fingerprint }));
      // Score invalidation separately: a fresh attempt that times out still proves
      // the old result was not reused. Keep its completion status visible below.
      t.check(fingerprint.actions, equals(["executed"]))
        .score(2).key("harness.cancel-async-authoring.criteria-fingerprint")
        .label("隐藏判据变化会自动作废旧结果");
      t.check({ exitCode: fingerprint.exitCode, results: fingerprint.results }, equals({ exitCode: 0, results: expectPassed }))
        .key("harness.cancel-async-authoring.fingerprint-probe-completed")
        .label("无行为变化的判据探针运行完成且参考实现仍通过");

      const leak = await inspect(shell, ["leak-probe", "--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "leak-probe", ...leak }));
      t.check({ exitCode: leak.exitCode, results: leak.results }, equals({ exitCode: 1, results: expectFailed }))
        .score(3).key("harness.cancel-async-authoring.leak-probe-fails")
        .label("未见隐藏材料的负向探针保持 ordinary failed");

      // Independent mutation catches skipped tests and ignored verifier exit codes.
      await t.sandbox.writeText(officialTestsPath,
        `${originalOfficialTests}\n\ndef test_harness_verifier_must_execute():\n    assert False, "outer harness verifier sentinel"\n`);
      const sentinel = await inspect(shell, ["oracle", "--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "verifier-sentinel", ...sentinel }));
      t.check({ exitCode: sentinel.exitCode, results: sentinel.results }, equals({ exitCode: 1, results: expectFailed }))
        .score(2).key("harness.cancel-async-authoring.verifier-enforced")
        .label("真实测试新增失败会使 oracle ordinary failed，而非忽略退出码");
    } finally {
      await t.sandbox.writeText(officialTestsPath, originalOfficialTests);
    }
  },
});

type Cell = { evalId: string; members: { publication?: { verdict?: string } }[] };
type PlannedAttempt = { evalId: string; verdict?: string; publication?: { action?: string } };

/** experiment.get 的当前结果：evalId → 已发布 verdict（每格 1 次 Attempt）。没跑过为空表。 */
function currentVerdicts(doc: { experiment: { cells: Cell[] } } | null) {
  return Object.fromEntries((doc?.experiment.cells ?? []).map((c) => [c.evalId, c.members[0]?.publication?.verdict ?? null]));
}

/** 外层跑一次 exp，再用 receipt 里唯一的 Run 读取这次的终态与 publication action。 */
async function inspect(shell: Shell, args: string[]) {
  const { exitCode, runIds } = await exp(shell, args);
  if (runIds.length !== 1) throw new Error(`niceeval exp ${args.join(" ")} 应创建恰好一个 Run，实际 ${JSON.stringify(runIds)}`);
  const run = await query(shell, { kind: "run.get", runId: runIds[0] });
  const attempts: PlannedAttempt[] = run.run.plannedAttempts;
  const result = {
    exitCode,
    results: Object.fromEntries(attempts.map((a) => [a.evalId, a.verdict ?? null])),
    actions: attempts.map((a) => a.publication?.action ?? null),
  };
  return result;
}
