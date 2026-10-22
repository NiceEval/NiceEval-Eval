/** Public query wire data only: never import a candidate's private Record implementation. */
export type JsonObject = Record<string, unknown>;
export function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Harness evidence unavailable: ${label} is not an object`);
  }
  return value as JsonObject;
}
export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Harness evidence unavailable: ${label} is not an array`);
  return value;
}
export function queryDocument(stdout: string, kind: string): JsonObject {
  const doc = object(JSON.parse(stdout), "query document");
  const expectedOperation = doc.protocol === "niceeval.query/v2"
    ? ({ "runs.list": "run.list", "run.summary": "run.get" }[kind] ?? kind) : kind;
  if (!["niceeval.query/v1", "niceeval.query/v2"].includes(String(doc.protocol)) || doc.operation !== expectedOperation || doc.outcome !== "success") {
    throw new Error(`Harness evidence unavailable: ${kind}: ${JSON.stringify(doc)}`);
  }
  if (array(doc.issues, "issues").length !== 0) {
    throw new Error(`Harness evidence unavailable: ${kind} has issues: ${JSON.stringify(doc.issues)}`);
  }
  return doc;
}
export interface RunRef { runId: string; startedAt: number }
export function runRefs(doc: JsonObject): RunRef[] {
  const selection = object(doc.selection, "runs.list selection");
  if (selection.truncated !== false) throw new Error("Harness evidence unavailable: truncated Run list");
  const refs = array(doc.runs, "runs").map((value) => {
    const row = object(value, "run");
    const startedAt = typeof row.startedAt === "number" ? row.startedAt : Date.parse(String(row.startedAt));
    if (typeof row.runId !== "string" || !Number.isFinite(startedAt)) {
      throw new Error("Harness evidence unavailable: invalid Run identity/time");
    }
    return { runId: row.runId, startedAt };
  });
  if (new Set(refs.map((r) => r.runId)).size !== refs.length) throw new Error("Duplicate Run identity");
  return refs.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId));
}
export interface Member {
  evalId: string;
  runId: string;
  locator?: string;
  state: string;
  verdict?: string;
  outcome?: string;
}
export interface RunResult { runId: string; experimentId: string; members: Member[] }
export function runResult(doc: JsonObject, runId: string): RunResult {
  const modern = doc.protocol === "niceeval.query/v2";
  const summary = object(modern ? doc.run : doc.summary, "run evidence");
  const runs = modern ? [object(summary.value, "run value")]
    : array(summary.runs, "summary.runs").map((r) => object(r, "run"));
  const run = runs.find((r) => r.runId === runId);
  if (!run || typeof run.experimentId !== "string") throw new Error("Harness evidence unavailable: fixed Run missing");
  if (run.completedAt === undefined || run.completedAt === null) {
    throw new Error("Harness evidence unavailable: fixed Run is still active");
  }
  const idKey = modern ? "plannedAttemptId" : "slotId";
  const slots = array(modern ? run.plannedAttempts : run.expectedSlots, "planned attempts").map((s) => object(s, "slot"));
  const members = array(modern ? summary.plannedAttempts : summary.members, "members").map((value) => {
    const m = object(value, "member");
    const slot = slots.find((s) => s[idKey] === m[idKey]);
    if (!slot || slot.evalId !== m.evalId || (!modern && m.runId !== runId) || typeof m.evalId !== "string" || typeof m.state !== "string") {
      throw new Error("Harness evidence unavailable: member/slot identity mismatch");
    }
    return {
      evalId: m.evalId, runId, state: m.state,
      ...(typeof m.locator === "string" ? { locator: m.locator } : {}),
      ...(typeof m.verdict === "string" ? { verdict: m.verdict } : {}),
      ...(typeof m.outcome === "string" ? { outcome: m.outcome } : {}),
    };
  });
  const denominator = object(summary.denominator, "denominator");
  if (denominator.expected !== slots.length || members.length !== slots.length
      || new Set(members.map((m) => m.evalId)).size !== members.length) {
    throw new Error("Harness evidence unavailable: missing or duplicate slot (one attempt per inner Eval required)");
  }
  return { runId, experimentId: run.experimentId, members };
}
export function currentMembers(runs: RunResult[], experimentId: string): Member[] {
  const current = new Map<string, Member>();
  for (const run of runs) {
    if (run.experimentId !== experimentId) continue;
    for (const member of run.members) current.set(member.evalId, member);
  }
  return [...current.values()].sort((a, b) => a.evalId.localeCompare(b.evalId));
}
export function matchesResults(members: Member[], expected: Record<string, string>): boolean {
  return members.length === Object.keys(expected).length
    && new Set(members.map((m) => m.evalId)).size === members.length
    && members.every((m) =>
    expected[m.evalId] === m.verdict && m.outcome === "completed"
      && ["executed", "carried", "accepted"].includes(m.state) && typeof m.locator === "string",
  );
}

/** Fresh execution proves invalidation even when that execution subsequently errors. */
export function hasFreshExecutions(members: Member[], evalIds: string[]): boolean {
  return members.length === evalIds.length && evalIds.length > 0
    && new Set(members.map((m) => m.evalId)).size === members.length
    && members.every((m) => evalIds.includes(m.evalId)
      && m.state === "executed" && typeof m.locator === "string");
}

/** The child node process supplies stdin without shell interpolation or workspace writes. */
const QUERY = `const {spawnSync}=require('node:child_process');
const minor=Number(JSON.parse(require('node:fs').readFileSync('node_modules/niceeval/package.json','utf8')).version.split('.')[1]);
const operation=JSON.parse(process.argv[1]);
if(minor>=19)operation.kind=({'runs.list':'run.list','run.summary':'run.get'})[operation.kind]??operation.kind;
const request={protocol:minor>=19?'niceeval.query/v2':'niceeval.query/v1',operation};
const r=spawnSync('pnpm',['exec','niceeval','query','run','--request','-'],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:16*1024*1024});
if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
if(r.error){process.stderr.write(String(r.error));process.exit(2)}process.exit(r.status??2);`;
export type RunCommand = (cmd: string, args: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
export async function publicQuery(runCommand: RunCommand, operation: JsonObject): Promise<JsonObject> {
  const result = await runCommand("node", ["-e", QUERY, JSON.stringify(operation)]);
  if (result.exitCode !== 0) throw new Error(`Harness evidence unavailable: query ${operation.kind}: ${result.stderr || result.stdout}`);
  return queryDocument(result.stdout, String(operation.kind));
}
export async function collectResults(runCommand: RunCommand): Promise<{ runIds: string[]; runs: RunResult[] }> {
  // Freeze the list before resolving any summaries. No exp/accept/migrate is performed here.
  const refs = runRefs(await publicQuery(runCommand, { kind: "runs.list" }));
  const runs: RunResult[] = [];
  for (let i = 0; i < refs.length; i++) {
    if (i > 0 && refs[i]!.startedAt === refs[i - 1]!.startedAt) {
      throw new Error("Harness evidence unavailable: ambiguous Run order");
    }
    const { runId } = refs[i]!;
    runs.push(runResult(await publicQuery(runCommand, { kind: "run.summary", runId }), runId));
  }
  return { runIds: refs.map((r) => r.runId), runs };
}

/** For authoring only: this tests the delivered Eval, not whether the student ran it. */
export async function executeAndInspect(runCommand: RunCommand, experiment: string, args: string[] = []) {
  const before = new Set(runRefs(await publicQuery(runCommand, { kind: "runs.list" })).map((r) => r.runId));
  const command = await runCommand("pnpm", ["exec", "niceeval", "exp", experiment, ...args]);
  const added = runRefs(await publicQuery(runCommand, { kind: "runs.list" })).filter((r) => !before.has(r.runId));
  if (added.length > 1) throw new Error("Harness evidence unavailable: one inner experiment published multiple Runs");
  const runId = added[0]?.runId;
  const run = runId === undefined ? undefined : runResult(await publicQuery(runCommand, { kind: "run.summary", runId }), runId);
  if (run && run.experimentId !== experiment) throw new Error("Harness evidence unavailable: unexpected experiment identity");
  return { exitCode: command.exitCode, run };
}
