import { spawnSync } from "node:child_process";
import { query, type Shell } from "../lib/query.ts";

const runIds = process.argv.slice(2);
if (runIds.length === 0 || runIds.some((id) => id.startsWith("-")) || new Set(runIds).size !== runIds.length) {
  throw new Error("Usage: pnpm harness-report <fixed-run-id> [<fixed-run-id> ...] (no latest, no duplicate Run)");
}
const shell: Shell = async (script) => {
  const r = spawnSync("sh", ["-c", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { exitCode: r.status ?? 2, stdout: r.stdout, stderr: r.stderr };
};
const reports = [];
for (const runId of runIds) {
  const doc = await query(shell, { kind: "run.get", runId });
  if (doc === null) throw new Error(`Run ${runId} 不存在`);
  const get = doc.run;
  const value = get.value;
  const execution = value.context.execution;
  const flags = execution.flags;
  const overview = get;
  const sourceMembers: Record<string, any>[] = get.members;
  const rows = (overview.plannedAttempts as Record<string, any>[]).map((member) => {
    const slot = member;
    const source = sourceMembers.find((s) => s.plannedAttemptId === slot.plannedAttemptId);
    const ref = source?.attempt ?? undefined;
    return {
      evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal,
      locator: member.publication?.attemptLocator ?? member.locator,
      action: source?.action, originRunId: ref?.originRunId, attemptId: ref?.attemptId,
      newSample: source?.action === "executed" && ref?.originRunId === runId,
      outcome: member.outcome, verdict: member.verdict, score: member.score, coverage: member.coverage, usage: member.usage,
      // Score alone never proves the non-scored scope/control assertions passed.
      boundaryReview: "inspect named assertions; not inferred from score",
    };
  });
  reports.push({
    runId, experimentId: value.experimentId,
    candidateVersion: flags.candidateVersion, rubricVersion: flags.harnessRubric ?? "legacy/unrecorded",
    model: execution.model, reasoningEffort: execution.reasoningEffort,
    denominator: overview.denominator,
    executed: rows.filter((r) => r.newSample).length,
    carried: rows.filter((r) => r.action === "carried").length,
    accepted: rows.filter((r) => r.action === "accepted").length,
    rows,
  });
}
console.log(JSON.stringify({
  kind: "harness-fixed-run-observations/v1",
  comparison: "Product-version observations; docs-only causality requires a separately fixed runtime and doc snapshots. Do not compare different rubrics or treat carried/accepted/duplicate Attempt IDs as new samples.",
  reports,
}, null, 2));
