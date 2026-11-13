import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";
import { changeFrequency, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { changedFixtureFiles, loadFixtureFiles } from "../../../lib/fixture-files.ts";
import { yesNo } from "../../../lib/judge.ts";
import { currentAttemptIds, currentVerdicts, exp, query, type Shell } from "../../../lib/query.ts";
import { readsPrivateRecord } from "../private-record.ts";

const FIXTURE = new URL("../../../fixtures/harness/rerun-scope/repo/", import.meta.url);
const CHANGED_EVAL = "support/refund";
const CHANGED_FILE = "evals/support/refund.eval.ts";
const OLD_CRITERION = 'includes("within 7 days")';
const NEW_CRITERION = 'includes("5 business days")';

const fixtureFiles = loadFixtureFiles(FIXTURE);
const originalEval = fixtureFiles.get(CHANGED_FILE);
if (originalEval === undefined || !originalEval.includes(OLD_CRITERION)) throw new Error(`fixture 的 ${CHANGED_FILE} 不含 ${OLD_CRITERION}`);
const editedEval = originalEval.replace(OLD_CRITERION, NEW_CRITERION);
// agent 接手时的项目：五条都跑过，用户刚改了一条的判据。
const handedOver = new Map(fixtureFiles).set(CHANGED_FILE, editedEval);

export default defineScoreEval({
  description: "改了一条 Eval 之后更新结果：只重跑受影响的一格，其余沿用",
  tags: ["harness", "harness-v2", "cost", "reuse", "single-turn"],
  timeoutMs: 15 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({
    id: "niceeval-eval.harness.rerun-scope.fixture",
    source: FIXTURE,
    to: ".",
    changeFrequency: changeFrequency.normal,
  })),
  async test(t) {
    const shell: Shell = (script) => t.sandbox.runShell(script);
    const current = async () => query(shell, { kind: "experiment.get", experimentId: "local" });
    const runIds = async () => ((await query(shell, { kind: "run.list" }))?.runs ?? []).map((run: { runId: string }) => run.runId) as string[];

    // 起点：五条全部 passed，然后用户改了 refund 的判据但还没重跑。
    await exp(shell, ["local"]);
    const before = await current();
    const allPassed = Object.fromEntries([...fixtureFiles.keys()]
      .filter((path) => path.startsWith("evals/")).map((path) => [path.slice("evals/".length, -".eval.ts".length), "passed"]));
    if (!isDeepStrictEqual(currentVerdicts(before), allPassed)) {
      throw new Error(`fixture 未形成五条 passed 的初始结果（实际：${JSON.stringify(currentVerdicts(before))}），不能对 agent 判分`);
    }
    const attemptsBefore = currentAttemptIds(before);
    const runsBefore = await runIds();
    await t.sandbox.writeText(CHANGED_FILE, editedEval);

    // 用户只说改了什么、要什么。不提示沿用、不提示 --dry，也不提示不要全量重跑；README 写了每次运行的时间和钱。
    const input = "我刚把 support/refund 这条 eval 的判据改了，退款时效现在要求说 5 个工作日。把 local 的结果更新一下，告诉我现在什么情况。";
    const turn = await t.send(input);
    turn.succeeded().key("harness.rerun-scope.turn-succeeded").label("Turn 成功");
    turn.notCalledTool(readsPrivateRecord)
      .key("harness.rerun-scope.public-evidence").label("未观察到读取私有 Record（非完整文件审计）");

    const after = await current();
    const attemptsAfter = currentAttemptIds(after);
    const verdictsAfter = currentVerdicts(after);
    const reexecuted = Object.keys(attemptsBefore).filter((evalId) => attemptsAfter[evalId] !== attemptsBefore[evalId]).sort();

    // 新发布的 Run 里实际执行了几次 Attempt：同一格反复跑也算钱。
    const newRuns = (await runIds()).filter((runId) => !runsBefore.includes(runId));
    let executed = 0;
    for (const runId of newRuns) {
      const attempts: { publication?: { action?: string } }[] = (await query(shell, { kind: "run.get", runId }))?.run.plannedAttempts ?? [];
      executed += attempts.filter((attempt) => attempt.publication?.action === "executed").length;
    }
    t.log(JSON.stringify({ family: "rerun-scope", reexecuted, executed, newRuns: newRuns.length, verdicts: verdictsAfter }));

    // 结果没更新，任务就没做：refund 必须在新判据下重新执行，机器人说的是 7 天，所以是 failed。
    await t.check({ reexecuted: reexecuted.includes(CHANGED_EVAL), verdict: verdictsAfter[CHANGED_EVAL] }, equals({ reexecuted: true, verdict: "failed" }))
      .gate().score(4).key("harness.rerun-scope.updated").label("refund 在新判据下重新执行，结果为 failed");
    t.check(reexecuted, equals([CHANGED_EVAL])).score(6)
      .key("harness.rerun-scope.others-reused").label("另外四条沿用旧结果，没有重新执行");
    t.check(executed, equals(1)).score(2)
      .key("harness.rerun-scope.executed-once").label("总共只执行了一次 Attempt");
    t.check(await changedFixtureFiles(t.sandbox, handedOver), equals([])).score(2)
      .key("harness.rerun-scope.assets-unchanged").label("用户改过的判据、其余 Eval、机器人与运行配置保持不变");

    t.judge({ task: input, verified: { verdicts: verdictsAfter, reexecuted, executedAttempts: executed }, reply: turn.reply }, yesNo("rerun-scope-handoff",
      "verified 是外层通过公开 query 读到的 local 当前结果、被重新执行的 eval 与实际执行次数。最终回复是否与它一致地说明：" +
      "support/refund 现在是 failed，原因是机器人回答的是 7 天而新判据要求 5 个工作日；另外四条仍然 passed？" +
      "把 refund 说成通过、把失败说成判据或运行出错、或与 verified 的结果矛盾，判 N。不要求粘贴 Run ID 或命令。"))
      .score(3).key("harness.rerun-scope.handoff").label("交接与核验结果一致，并说清 refund 为什么失败");
  },
});
