import assert from "node:assert/strict";
import { test } from "node:test";
import { currentVerdicts, query, runOnce } from "../lib/query.ts";
import { NEVER_CALLED_EXPERIMENT, withTempProject } from "./support/project.ts";

const evalSource = (body: string) => `import {defineEval} from 'niceeval'; import {equals} from 'niceeval/expect';
export default defineEval({test(t){${body}}});\n`;

// 这里固定的是各 Eval 直接读取的 稳定版 v2 / Canary v3 的公开字段与 exp receipt 语义。
test("Eval 读取的 query 字段：当前结果、局部修复、沿用与判据失效", { timeout: 120_000 }, () => withTempProject("query-contract", {
  "experiments/local.ts": NEVER_CALLED_EXPERIMENT,
  "evals/good.eval.ts": evalSource("t.check(true, equals(true));"),
  "evals/business.eval.ts": evalSource("t.check(false, equals(true));"),
  "evals/broken.eval.ts": evalSource("throw new Error('deliberate execution failure');"),
}, async ({ shell, write }) => {
  const current = async () => currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
  const run = (args: string[]) => runOnce(shell, args);

  assert.equal(await query(shell, { kind: "experiment.get", experimentId: "local" }), null, "没跑过的 Experiment 是 null，不是错误");
  assert.deepEqual((await query(shell, { kind: "run.list" })).runs, []);

  const first = await run(["local"]);
  assert.equal(first.exitCode, 1);
  assert.deepEqual(first.results, { broken: "errored", business: "failed", good: "passed" });
  assert.deepEqual(await current(), { broken: "errored", business: "failed", good: "passed" });

  await write("evals/broken.eval.ts", evalSource("t.check(1, equals(1));"));
  const repaired = await run(["local", "broken", "--rerun", "all"]);
  assert.deepEqual({ exitCode: repaired.exitCode, results: repaired.results }, { exitCode: 0, results: { broken: "passed" } });
  assert.deepEqual(await current(), { broken: "passed", business: "failed", good: "passed" }, "局部修复与较早的对照结果组合成当前结果");
  const project = (await query(shell, { kind: "project.get" })).project;
  const publications = project.cells.flatMap((cell: { evalId: string; members: { verdict?: string; publication: { attemptLocator?: string; verdict?: string; originRunId?: string } }[] }) =>
    cell.members.map((member) => ({ evalId: cell.evalId, ...member.publication, verdict: member.verdict ?? member.publication.verdict })),
  );
  assert.deepEqual(Object.fromEntries(publications.map((p: { evalId: string; verdict?: string }) => [p.evalId, p.verdict])),
    { broken: "passed", business: "failed", good: "passed" });
  assert.ok(publications.every((p: { attemptLocator?: string }) => typeof p.attemptLocator === "string"));
  assert.equal(publications.find((p: { evalId: string }) => p.evalId === "broken")?.originRunId, repaired.runId);
  assert.equal(publications.find((p: { evalId: string }) => p.evalId === "good")?.originRunId, first.runId);


  const reused = await run(["local", "broken"]);
  assert.deepEqual(reused.actions, ["carried"]);

  await write("evals/broken.eval.ts", evalSource("t.check(false, equals(true));"));
  await run(["local", "broken", "--rerun", "all"]);
  assert.deepEqual(await current(), { broken: "failed", business: "failed", good: "passed" }, "后来的回归覆盖较早的成功修复");

  await write("criteria.txt", "ready");
  await write("evals/criteria.eval.ts", `import {defineEval} from 'niceeval';
import {loadText} from 'niceeval/loaders'; import {equals} from 'niceeval/expect';
const criteria = await loadText('criteria.txt');
export default defineEval({test(t){if(criteria !== 'ready') throw new Error('probe execution unavailable');
t.check(true, equals(true));}});\n`);
  assert.deepEqual((await run(["local", "criteria"])).results, { criteria: "passed" });
  assert.deepEqual((await run(["local", "criteria"])).actions, ["carried"]);
  await write("criteria.txt", "changed");
  const invalidated = await run(["local", "criteria"]);
  assert.deepEqual(invalidated.actions, ["executed"], "判据文件改变后不沿用旧结果，即使新执行出错");
  assert.deepEqual(invalidated.results, { criteria: "errored" });

  const runIds = (await query(shell, { kind: "run.list" })).runs.map((r: { runId: string }) => r.runId);
  assert.ok(runIds.includes(first.runId));
  await assert.rejects(query(shell, { kind: "no.such.operation" }), /未提供 operation/);
}));
