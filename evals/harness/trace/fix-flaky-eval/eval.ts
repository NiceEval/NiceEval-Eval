import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import type { StreamEvent } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { loadText } from "niceeval/loaders";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { query, runOnce, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/fix-flaky-eval/repo/", import.meta.url);
const AGENT_FILE = "agents/research-bot.ts";
const probeAgent = await loadText(new URL("../../../../fixtures/harness/fix-flaky-eval/probe-agent.ts", import.meta.url));
const originalAgent = readFileSync(new URL(AGENT_FILE, FIXTURE), "utf8");

function historicalInspections(events: readonly StreamEvent[], locators: readonly string[]) {
  const inputs = new Map<string, string>();
  return events.flatMap(event => {
    if (event.type === "operation.started" && event.operation.kind === "tool") {
      inputs.set(event.operationId, JSON.stringify(event.operation.input) ?? "");
    }
    if (event.type !== "operation.finished" || event.kind !== "tool") return [];
    const input = inputs.get(event.operationId) ?? "";
    if (!/\bniceeval\b[\s\S]*\b(?:show|query|view)\b/.test(input)) return [];
    const output = typeof event.output === "string" ? event.output : (JSON.stringify(event.output) ?? "");
    const attempts = locators.filter((locator) => input.includes(locator) || output.includes(locator));
    if (attempts.length === 0) return [];
    const lines = output.split("\n");
    const matchingLines = new Set<number>();
    for (const [index, line] of lines.entries()) {
      if (/search_web|search_papers|energy\.example\/report|papers\.example\/study/.test(line)) {
        for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i++) matchingLines.add(i);
      }
    }
    const excerpts = [...matchingLines].map((i) => lines[i]!.length > 4000
      ? [...lines[i]!.matchAll(/.{0,250}(?:search_web|search_papers|energy\.example\/report|papers\.example\/study).{0,250}/g)].map((match) => match[0]).join(" … ")
      : lines[i]);
    return excerpts.length ? [{ attempts, command: input.slice(0, 1000), excerpts }] : [];
  });
}

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
    const baseline = await query(shell, { kind: "run.get", runId: initialRun.runId });
    const historicalSamples = (baseline.run.plannedAttempts as {
      evalId: string; attemptOrdinal?: number; attempt?: number; verdict: string;
      publication?: { attemptLocator?: string };
    }[]).filter((attempt) => attempt.evalId === "research/sources").map((attempt) => {
      const locator = attempt.publication?.attemptLocator;
      const ordinal = attempt.attemptOrdinal ?? attempt.attempt;
      if (!locator || ordinal === undefined) throw new Error("fixture 的历史 sources 样本缺少公开定位");
      return { locator, ordinal, verdict: attempt.verdict };
    });
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
    t.judge({ reply: turn.reply, historicalSamples, inspections: historicalInspections(turn.events, historicalSamples.map(({ locator }) => locator)) }, binaryJudge({ rubric:
      "Agent 用真实历史样本确认 search_web 与 search_papers 返回的来源内容相同、完成和列出来源的顺序不同，并将两过两败归因于原 Eval 的有序比较。" +
      "从已读的公开历史结果或交接中可核实的历史样本确认对照；只从源码猜测根因、没有对照实际样本不算。" }))
      .score(2).label("历史样本证实有序比较导致不稳定");
    t.judge({ reply: turn.reply, historicalRunId: initialRun.runId, historicalSamples }, binaryJudge({ rubric:
      "最终交接给出两次实际历史记录的可复查定位和各自的工具返回顺序，一次先 search_web、一次先 search_papers。" +
      "原判据中先 search_web 的样本 passed，先 search_papers 的样本 failed，用 historicalSamples 核对引用没有写反。Attempt locator、能定位到两个具体样本的公开命令或 Run 与样本位置均可，无需固定模板。只列复验 Run 或笼统说顺序不同不算。" }))
      .score(1).label("交接可复查两次历史返回顺序");
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
