import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, referencesAnyPath, toolMatch } from "niceeval/expect";
import { loadCriteria, loadText } from "niceeval/loaders";
import { changeFrequency, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { collectResults, currentMembers, executeAndInspect, verdicts } from "../../../../lib/harness/public-results.ts";

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
    const input = `仓库里有一份从 Terminal-Bench 裁出的 cancel-async-tasks 原始题包，但还没有接入 NiceEval。

请只创建 ${TARGET_EVAL}，把它做成正式 Eval：保持 task/task.yaml 的官方题意，使用 task/fixture/Dockerfile，并把未经修改的官方 tests 作为唯一业务判据。tests、run-tests 脚本和 solution 都是隐藏判据或参考答案，必须在被测 agent 收工以后才进入 task sandbox，不能进入 Docker build context，也不能提前出现在 agent 可见的文件系统里。隐藏测试及 runner 还必须进入这条 Eval 的 fingerprint，判据内容改变后不能复用旧结果。

当前 Harness 可以访问互联网；请使用未经修改的官方 task/run-tests.sh 安装固定版本测试依赖并执行官方 tests。预载 runtime 只是构建缓存，不是离线限制。不要修改 task/、agents/、experiments/ 或其它文件。

请把 oracle 和 leak-probe 两格都实际跑完并用公开 NiceEval 结果核对：oracle 应 passed；leak-probe 应 ordinary failed 而不是 errored。完成后告诉我结果。`;
    const turn = await t.send(input);
    // Observe student runs before the outer verifier creates any Run of its own.
    const student = await collectResults((cmd, args) => t.sandbox.runCommand(cmd, args));
    t.log(JSON.stringify({ rubric: "harness-v2", studentRunIds: student.runIds, studentRuns: student.runs }));
    t.check({
      oracle: verdicts(currentMembers(student.runs, "oracle")),
      "leak-probe": verdicts(currentMembers(student.runs, "leak-probe")),
    }, equals({
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

    const runCommand = (cmd: string, args: readonly string[]) => t.sandbox.runCommand(cmd, args);
    const expectPassed = { "terminal-bench/cancel-async-tasks": "passed" };
    const expectFailed = { "terminal-bench/cancel-async-tasks": "failed" };
    const oracle = await executeAndInspect(runCommand, "oracle", ["--rerun", "all"]);
    t.log(JSON.stringify({ outerProbe: "oracle", ...oracle }));
    t.check(outcome(oracle), equals({ exitCode: 0, results: expectPassed }))
      .score(6).key("harness.cancel-async-authoring.oracle-passes")
      .label("官方参考实现通过完整官方判据");

    const officialTestsPath = "task/tests/test_outputs.py";
    const originalOfficialTests = protectedContents.find(([path]) => path === officialTestsPath)?.[1];
    if (originalOfficialTests === undefined) throw new Error("fixture 缺少官方测试");
    try {
      await t.sandbox.writeText(officialTestsPath,
        `${originalOfficialTests}\n# Harness fingerprint probe: behavior intentionally unchanged.\n`);
      // No rerun flag: this specifically tests criteria invalidation.
      const fingerprint = await executeAndInspect(runCommand, "oracle");
      t.log(JSON.stringify({ outerProbe: "fingerprint", ...fingerprint }));
      // Score invalidation separately: a fresh attempt that times out still proves
      // the old result was not reused. Keep its completion status visible below.
      t.check(fingerprint.run?.members.map((m) => m.state) ?? [], equals(["executed"]))
        .score(2).key("harness.cancel-async-authoring.criteria-fingerprint")
        .label("隐藏判据变化会自动作废旧结果");
      t.check(outcome(fingerprint), equals({ exitCode: 0, results: expectPassed }))
        .key("harness.cancel-async-authoring.fingerprint-probe-completed")
        .label("无行为变化的判据探针运行完成且参考实现仍通过");

      const leak = await executeAndInspect(runCommand, "leak-probe", ["--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "leak-probe", ...leak }));
      t.check(outcome(leak), equals({ exitCode: 1, results: expectFailed }))
        .score(3).key("harness.cancel-async-authoring.leak-probe-fails")
        .label("未见隐藏材料的负向探针保持 ordinary failed");

      // Independent mutation catches skipped tests and ignored verifier exit codes.
      await t.sandbox.writeText(officialTestsPath,
        `${originalOfficialTests}\n\ndef test_harness_verifier_must_execute():\n    assert False, "outer harness verifier sentinel"\n`);
      const sentinel = await executeAndInspect(runCommand, "oracle", ["--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "verifier-sentinel", ...sentinel }));
      t.check(outcome(sentinel), equals({ exitCode: 1, results: expectFailed }))
        .score(2).key("harness.cancel-async-authoring.verifier-enforced")
        .label("真实测试新增失败会使 oracle ordinary failed，而非忽略退出码");
    } finally {
      await t.sandbox.writeText(officialTestsPath, originalOfficialTests);
    }
  },
});

/** 一次外层 exp 的可比较结果：退出码与该 Run 内每条 Eval 的终态。 */
function outcome(probe: Awaited<ReturnType<typeof executeAndInspect>>) {
  return { exitCode: probe.exitCode, results: verdicts(probe.run?.members ?? []) };
}
