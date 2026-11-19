import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { loadText } from "niceeval/loaders";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { query, runOnce, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/fix-flaky-eval/repo/", import.meta.url);
const AGENT_FILE = "agents/research-bot.ts";
const probeAgent = await loadText(new URL("../../../../fixtures/harness/fix-flaky-eval/probe-agent.ts", import.meta.url));
const originalAgent = readFileSync(new URL(AGENT_FILE, FIXTURE), "utf8");

export default defineScoreEval({
  description: "诊断并修复依赖并发返回顺序的来源判据，拒绝缺失、编造和重复来源",
  tags: ["harness", "harness-v2", "trace", "authoring", "criteria-repair"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({ id: "fixture", source: FIXTURE, to: "." })),
  async test(t) {
    const shell: Shell = (script) => t.sandbox.runShell(script);
    // 四个 Attempt 不能投影成单一 verdict，否则会丢失不稳定性证据。
    const verdicts = async (runId?: string) => {
      if (runId !== undefined) {
        const doc = await query(shell, { kind: "run.get", runId });
        const attempts: { evalId: string; verdict?: string | null }[] = doc.run.plannedAttempts;
        return Object.fromEntries([...new Set(attempts.map(a => a.evalId))].sort().map(id =>
          [id, attempts.filter(a => a.evalId === id).map(a => a.verdict ?? null).sort()]));
      }
      const doc = await query(shell, { kind: "experiment.get", experimentId: "local" });
      return Object.fromEntries((doc?.experiment.cells ?? []).map((cell: {
        evalId: string; members: { verdict?: string | null; publication?: { verdict?: string } }[];
      }) => [cell.evalId, cell.members.map(member => member.verdict ?? member.publication?.verdict ?? null).sort()]));
    };
    const initialRun = await runOnce(shell, ["local", "--rerun", "all"]);
    const initial = await verdicts(initialRun.runId);
    const startingPoint = {
      "research/greeting": ["passed", "passed", "passed", "passed"],
      "research/sources": ["failed", "failed", "passed", "passed"],
    };
    if (!isDeepStrictEqual(initial, startingPoint)) throw new Error(`fixture 起点不符：${JSON.stringify(initial)}`);
    const input = "research/sources 时过时不过，查清楚是助手的问题还是测试的问题，是测试的问题就改好并复验。";
    const turn = await t.send(input);
    turn.succeeded().label("任务 Turn 成功");
    t.notCalledTool(readsPrivateRecord).gate().label("未观察到读取私有 Record（非完整文件审计）");

    const student = await verdicts();
    t.log(JSON.stringify({ condition: "fix-flaky-eval", initial, student }));
    t.check(student, equals({
      "research/greeting": ["passed", "passed", "passed", "passed"],
      "research/sources": ["passed", "passed", "passed", "passed"],
    })).score(2).label("Agent 自己复验 local：四次 sources 都 passed");
    t.judge({ reply: turn.reply, task: input }, binaryJudge({ rubric:
      "隐藏事实：助手并发发起 search_web 与 search_papers，两者完成顺序随 Attempt 交替，回复来源顺序随之改变，但内容始终正确。原 Eval 要求固定来源顺序，故两过两败。最终回复是否明确归因为判据依赖顺序而非助手不稳定，并引用至少两个 Attempt 的公开 show/query 证据或 locator，准确对比两次工具返回顺序差异？三项都满足才算。" }))
      .score(3).label("诊断说中判据依赖顺序，并引用两次 Attempt 的工具返回顺序");
    t.judge({ reply: turn.reply, verifiedResults: student }, binaryJudge({ rubric:
      "最终交接是否如实说明改了来源顺序判据并复验，运行结果与 verifiedResults 相符，未把没有执行的结果说成已通过？" }))
      .score(1).label("交接如实");
    t.sandbox.unchangedWithin(["agents", "experiments", "niceeval.config.ts", "evals/research/greeting.eval.ts"])
      .gate().label("题面、助手与其它 Eval 不变");
    // unchangedWithin 在收尾评估；探针 finally 恢复文件前，先核对原 Agent，避免覆盖越界证据。
    await t.check(await t.sandbox.readText(AGENT_FILE), equals(originalAgent))
      .gate().label("探针前 canned agent 原文未改").orStop();
    const probe = async (name: string) => {
      const run = await runOnce(script => t.sandbox.runShell(script, { env: { HARNESS_SOURCES_PROBE: name } }), ["local", "research/sources", "--rerun", "all"]);
      const results = await verdicts(run.runId);
      t.log(JSON.stringify({ probe: name, runId: run.runId, results }));
      return results;
    };
    const expected = (verdict: "passed" | "failed") => ({ "research/sources": [verdict, verdict, verdict, verdict] });
    try {
      await t.sandbox.writeText(AGENT_FILE, probeAgent);
      t.check(await probe("order-a"), equals(expected("passed"))).score(4).label("正确顺序 A passed");
      t.check(await probe("order-b"), equals(expected("passed"))).score(4).label("正确顺序 B passed");
      t.check(await probe("missing"), equals(expected("failed"))).score(4).label("漏掉一个来源 ordinary failed");
      t.check(await probe("fabricated"), equals(expected("failed"))).score(4).label("编造不存在的来源 ordinary failed");
      t.check(await probe("duplicate"), equals(expected("failed"))).score(2).label("来源全对但重复列两次 ordinary failed");
    } finally {
      await t.sandbox.writeText(AGENT_FILE, originalAgent);
    }
  },
});
