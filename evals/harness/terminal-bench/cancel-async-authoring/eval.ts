import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, referencesAnyPath, toolMatch } from "niceeval/expect";
import { loadCriteria, loadText } from "niceeval/loaders";
import { changeFrequency, sandboxLayer, uploadDirectory } from "niceeval/sandbox";

const TARGET_EVAL = "evals/terminal-bench/cancel-async-tasks.eval.ts";
const FIXTURE_ROOT = "../../../../fixtures/harness/terminal-bench/cancel-async-authoring/repo/";
const PROTECTED_ASSETS = [
  "task/task.yaml",
  "task/fixture/Dockerfile",
  "task/run-tests.sh",
  "task/run-tests-offline.sh",
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

function stripAnsi(output: string): string {
  return output.replace(/\u001b\[[0-9;]*m/gu, "");
}

function hasExactSummary(
  output: string,
  expected: { passed: number; failed: number; errored: number },
): boolean {
  const plain = stripAnsi(output);
  const { passed, failed, errored } = expected;
  const patterns = [
    new RegExp(`\\b${passed}\\s+passed\\s+·\\s+${failed}\\s+failed\\s+·\\s+${errored}\\s+errored\\b`, "u"),
    new RegExp(`summary:\\s*${passed}\\s+passed,\\s*${failed}\\s+failed,\\s*${errored}\\s+errored\\b`, "iu"),
    new RegExp(`${passed}\\s+通过\\s+·\\s+${failed}\\s+失败\\s+·\\s+${errored}\\s+出错\\b`, "u"),
  ];
  return patterns.some((pattern) => pattern.test(plain));
}

function reportsZeroReuse(output: string): boolean {
  const plain = stripAnsi(output);
  return /\(0 reused\)|\(复用 0\)|\b0 reused\b/iu.test(plain);
}

export default defineScoreEval({
  description: "把真实 Terminal-Bench 题包接成不泄漏判据、带正反控制的正式 Eval",
  tags: ["harness", "terminal-bench", "authoring", "hidden-tests", "deterministic", "single-turn"],
  timeoutMs: 30 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxLayer().before(uploadDirectory({
    id: "niceeval-eval.harness.cancel-async-authoring.fixture",
    source: new URL(FIXTURE_ROOT, import.meta.url),
    to: ".",
    changeFrequency: changeFrequency.normal,
  })),
  async test(t) {
    const input = `仓库里有一份从 Terminal-Bench 裁出的 cancel-async-tasks 原始题包，但还没有接入 NiceEval。

请只创建 ${TARGET_EVAL}，把它做成正式 Eval：保持 task/task.yaml 的官方题意，使用 task/fixture/Dockerfile，并把未经修改的官方 tests 作为唯一业务判据。tests、run-tests 脚本和 solution 都是隐藏判据或参考答案，必须在被测 agent 收工以后才进入 task sandbox，不能进入 Docker build context，也不能提前出现在 agent 可见的文件系统里。隐藏测试及 runner 还必须进入这条 Eval 的 fingerprint，判据内容改变后不能复用旧结果。

当前 Harness 完全离线；task/run-tests-offline.sh 只替换官方 run-tests.sh 的联网依赖 bootstrap，执行的仍是原样官方 tests。不要修改 task/、agents/、experiments/ 或其它文件。

请把 oracle 和 leak-probe 两格都实际跑完并用公开 niceeval show 核对：oracle 应 passed；leak-probe 应 ordinary failed 而不是 errored。完成后告诉我结果。`;
    const turn = await t.send(input);

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

    const protectedAssetsUnchanged = (
      await Promise.all(
        protectedContents.map(async ([path, expected]) =>
          (await t.sandbox.readText(path).catch(() => undefined)) === expected
        ),
      )
    ).every(Boolean);
    t.check(protectedAssetsUnchanged, equals(true))
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

    const oracle = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "oracle"],
    );
    const oracleOutput = `${oracle.stdout}\n${oracle.stderr}`;
    t.check(
      oracle.exitCode === 0
        && hasExactSummary(oracleOutput, { passed: 1, failed: 0, errored: 0 }),
      equals(true),
    )
      .score(6)
      .key("harness.cancel-async-authoring.oracle-passes")
      .label("官方参考实现通过完整官方判据");

    const officialTestsPath = "task/tests/test_outputs.py";
    const originalOfficialTests = protectedContents.find(([path]) => path === officialTestsPath)?.[1];
    if (originalOfficialTests === undefined) {
      throw new Error("cancel-async fixture 缺少 fingerprint probe 的官方测试内容");
    }
    await t.sandbox.writeText(
      officialTestsPath,
      `${originalOfficialTests}\n# Harness fingerprint probe: behavior intentionally unchanged.\n`,
    );
    const fingerprintProbe = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "oracle"],
    );
    const fingerprintOutput = `${fingerprintProbe.stdout}\n${fingerprintProbe.stderr}`;
    t.check(
      fingerprintProbe.exitCode === 0
        && hasExactSummary(fingerprintOutput, { passed: 1, failed: 0, errored: 0 })
        && reportsZeroReuse(fingerprintOutput),
      equals(true),
    )
      .score(2)
      .key("harness.cancel-async-authoring.criteria-fingerprint")
      .label("隐藏判据变化会自动作废旧结果");

    const leakProbe = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "leak-probe"],
    );
    const leakProbeOutput = `${leakProbe.stdout}\n${leakProbe.stderr}`;
    t.check(
      leakProbe.exitCode === 1
        && hasExactSummary(leakProbeOutput, { passed: 0, failed: 1, errored: 0 }),
      equals(true),
    )
      .score(3)
      .key("harness.cancel-async-authoring.leak-probe-fails")
      .label("未见隐藏材料的负向探针保持 ordinary failed");
  },
});
