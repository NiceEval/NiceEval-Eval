import { spawnSync } from "node:child_process";
import { array, object, publicQuery, type RunCommand } from "../lib/harness/public-results.ts";

const runIds = process.argv.slice(2);
if (runIds.length === 0 || runIds.some((id) => id.startsWith("-")) || new Set(runIds).size !== runIds.length) {
  throw new Error("Usage: pnpm harness-report <fixed-run-id> [<fixed-run-id> ...] (no latest, no duplicate Run)");
}
const runCommand: RunCommand = async (cmd, args) => {
  const r = spawnSync(cmd, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { exitCode: r.status ?? 2, stdout: r.stdout, stderr: r.stderr };
};
const reports = [];
for (const runId of runIds) {
  const get = object((await publicQuery(runCommand, { kind: "run.get", runId })).run, "run");
  const value = object(get.value, "run value");
  const context = object(value.context, "run context");
  const execution = object(context.execution, "execution context");
  const flags = object(execution.flags, "flags");
  const overview = object((await publicQuery(runCommand, { kind: "run.overview", runId })).runOverview, "overview");
  const sourceMembers = array(get.members, "Run members").map((m) => object(m, "Run member"));
  const rows = array(overview.members, "overview members").map((m) => {
    const member = object(m, "member");
    const slot = object(member.slot, "slot");
    const source = sourceMembers.find((s) => s.slotId === slot.slotId);
    const ref = source?.attempt === undefined ? undefined : object(source.attempt, "attempt ref");
    return {
      evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal, locator: member.locator,
      state: member.state, originRunId: ref?.originRunId, attemptId: ref?.attemptId,
      newSample: member.state === "executed" && ref?.originRunId === runId,
      outcome: member.outcome, score: member.score, coverage: member.coverage, usage: member.usage,
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
    carried: rows.filter((r) => r.state === "carried").length,
    accepted: rows.filter((r) => r.state === "accepted").length,
    rows,
  });
}
console.log(JSON.stringify({
  kind: "harness-fixed-run-observations/v1",
  comparison: "Product-version observations; docs-only causality requires a separately fixed runtime and doc snapshots. Do not compare different rubrics or treat carried/accepted/duplicate Attempt IDs as new samples.",
  reports,
}, null, 2));
