/**
 * 把指定 Run 的 Harness 观察值汇成一份 JSON：逐题分数、来源、覆盖和用量。
 * 只读公开 query；必须给出固定 Run ID，不接受 latest。分数不代表边界合规，
 * 沿用（carried）与采用（accepted）的结果不算新样本。
 */

import { query } from "../lib/query.ts";
import { localShell } from "../tests/support/project.ts";

const runIds = process.argv.slice(2);
if (runIds.length === 0 || runIds.some((id) => id.startsWith("-")) || new Set(runIds).size !== runIds.length) {
  throw new Error("Usage: pnpm harness-report <fixed-run-id> [<fixed-run-id> ...] (no latest, no duplicate Run)");
}

type PlannedAttempt = Record<string, any> & { plannedAttemptId: string; evalId: string };
type SourceMember = { plannedAttemptId: string; action?: string; attempt?: { originRunId?: string; attemptId?: string } };

const shell = localShell(process.cwd());
const reports = [];
for (const runId of runIds) {
  const doc = await query(shell, { kind: "run.get", runId });
  if (doc === null) throw new Error(`Run ${runId} 不存在`);
  const { run } = doc;
  const { execution } = run.value.context;
  const sources: SourceMember[] = run.members;
  const rows = (run.plannedAttempts as PlannedAttempt[]).map((planned) => {
    const source = sources.find((member) => member.plannedAttemptId === planned.plannedAttemptId);
    return {
      evalId: planned.evalId,
      attemptOrdinal: planned.attemptOrdinal,
      locator: planned.publication?.attemptLocator ?? planned.locator,
      action: source?.action,
      originRunId: source?.attempt?.originRunId,
      attemptId: source?.attempt?.attemptId,
      newSample: source?.action === "executed" && source.attempt?.originRunId === runId,
      outcome: planned.outcome,
      verdict: planned.verdict,
      score: planned.score,
      coverage: planned.coverage,
      usage: planned.usage,
      // 分数从不证明不计分的范围与对照断言通过了。
      boundaryReview: "inspect named assertions; not inferred from score",
    };
  });
  reports.push({
    runId,
    experimentId: run.value.experimentId,
    candidateVersion: execution.flags.candidateVersion,
    rubricVersion: execution.flags.harnessRubric ?? "legacy/unrecorded",
    model: execution.model,
    reasoningEffort: execution.reasoningEffort,
    denominator: run.denominator,
    executed: rows.filter((row) => row.newSample).length,
    carried: rows.filter((row) => row.action === "carried").length,
    accepted: rows.filter((row) => row.action === "accepted").length,
    rows,
  });
}
console.log(JSON.stringify({
  kind: "harness-fixed-run-observations/v1",
  comparison: "Product-version observations; docs-only causality requires a separately fixed runtime and doc snapshots. Do not compare different rubrics or treat carried/accepted/duplicate Attempt IDs as new samples.",
  reports,
}, null, 2));
