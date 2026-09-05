import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  collectResults, currentMembers, executeAndInspect, matchesResults,
  object, publicQuery, queryDocument, runRefs, runResult,
  type JsonObject, type RunCommand,
} from "../lib/harness/public-results.ts";

// Real local CLI boundary, deterministic Assertions, no LLM, Docker, network service or paid attempts.
test("public verifier: missing work, partial repair, reuse and a later regression", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-harness-verifier-"));
  const runCommand: RunCommand = async (cmd, args) => {
    const r = spawnSync(cmd, [...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { exitCode: r.status ?? 2, stdout: r.stdout, stderr: r.stderr };
  };
  const evalSource = (body: string) => `import {defineEval} from 'niceeval'; import {equals} from 'niceeval/expect';
export default defineEval({test(t){${body}}});\n`;
  try {
    await mkdir(join(root, "experiments"));
    await mkdir(join(root, "evals"));
    await writeFile(join(root, "package.json"), '{"name":"harness-verifier-smoke","private":true,"type":"module"}\n');
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "niceeval.config.ts"), "import {defineConfig} from 'niceeval'; export default defineConfig({});\n");
    await writeFile(join(root, "experiments/local.ts"), `import {defineExperiment} from 'niceeval';
import {defineAgent,completeEvidenceCoverage} from 'niceeval/adapter';
export default defineExperiment({agent:defineAgent({name:'never-called',evidenceCoverage:completeEvidenceCoverage,
send(){throw new Error('No model invocation is allowed in verifier smoke')}}),evals:[''],attempts:1,maxConcurrency:1});\n`);
    await writeFile(join(root, "evals/good.eval.ts"), evalSource("t.check(true, equals(true));"));
    await writeFile(join(root, "evals/business.eval.ts"), evalSource("t.check(false, equals(true));"));
    await writeFile(join(root, "evals/broken.eval.ts"), evalSource("throw new Error('deliberate execution failure');"));
    assert.deepEqual((await collectResults(runCommand)).runs, [], "empty Record must mean no work, not query error");
    const first = await executeAndInspect(runCommand, "local");
    assert.equal(first.exitCode, 1);
    assert.ok(first.run);
    const expected = { good: "passed", business: "failed", broken: "passed" };
    assert.equal(matchesResults(first.run.members, expected), false, "errored is not a completed failed/pass result");
    await writeFile(join(root, "evals/broken.eval.ts"), evalSource("t.check(1, equals(1));"));
    const repaired = await executeAndInspect(runCommand, "local", ["broken", "--rerun", "all"]);
    assert.equal(repaired.exitCode, 0);
    assert.ok(repaired.run && matchesResults(repaired.run.members, { broken: "passed" }));
    const current = currentMembers((await collectResults(runCommand)).runs, "local");
    assert.ok(matchesResults(current, expected), "partial repair preserves the two older control slots");
    assert.ok(current.find((m) => m.evalId === "business")?.runId === first.run.runId);
    const reused = await executeAndInspect(runCommand, "local", ["broken"]);
    assert.ok(reused.run && reused.run.members.every((m) => m.state === "carried"));
    await writeFile(join(root, "evals/broken.eval.ts"), evalSource("t.check(false, equals(true));"));
    const regression = await executeAndInspect(runCommand, "local", ["broken", "--rerun", "all"]);
    assert.ok(regression.run && matchesResults(regression.run.members, { broken: "failed" }));
    assert.equal(matchesResults(currentMembers((await collectResults(runCommand)).runs, "local"), expected), false,
      "must not cherry-pick the earlier successful repair");

    const wire = await publicQuery(runCommand, { kind: "run.summary", runId: first.run.runId });
    const active = structuredClone(wire);
    const activeRun = (object(active.summary, "summary").runs as JsonObject[])[0]!;
    delete activeRun.completedAt;
    assert.throws(() => runResult(active, first.run!.runId), /still active/);
    const changed = structuredClone(wire);
    const summary = object(changed.summary, "summary");
    summary.members = [];
    assert.throws(() => runResult(changed, first.run!.runId), /missing or duplicate/);
    const wrongIdentity = structuredClone(wire);
    const members = object(wrongIdentity.summary, "summary").members as JsonObject[];
    members[0]!.evalId = "invented";
    assert.throws(() => runResult(wrongIdentity, first.run!.runId), /identity mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported, truncated and unavailable public evidence is not silently scored zero", () => {
  assert.throws(() => queryDocument('{"protocol":"niceeval.query/v1","outcome":"failure"}', "runs.list"), /unavailable/);
  assert.throws(() => queryDocument('{"protocol":"niceeval.query/v1","operation":"runs.list","outcome":"success","issues":[{"code":"missing"}]}', "runs.list"), /issues/);
  assert.throws(() => runRefs({ selection: { truncated: true }, runs: [] }), /truncated/);
  assert.equal(matchesResults([], { expected: "passed" }), false);
  const duplicated = { evalId: "a", runId: "r", state: "executed", verdict: "passed", outcome: "completed", locator: "@a" };
  assert.equal(matchesResults([duplicated, duplicated], { a: "passed", b: "passed" }), false);
  assert.equal(matchesResults([{ evalId: "a", runId: "r", state: "executed", verdict: "passed" }], { a: "passed" }), false);
});
