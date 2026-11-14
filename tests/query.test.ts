import assert from "node:assert/strict";
import { test } from "node:test";
import { currentAttemptIds, currentAttempts, currentVerdicts, query, runOnce, type Shell } from "../lib/query.ts";
import { NEVER_CALLED_EXPERIMENT, withTempProject } from "./support/project.ts";

const evalSource = (body: string) => `import {defineEval} from 'niceeval'; import {equals} from 'niceeval/expect';
export default defineEval({test(t){${body}}});\n`;

// 同一真实 CLI 契约可用隔离安装的候选验证，不改变本仓库依赖或版本矩阵。
test("Eval 读取的 Inspection 字段：当前结果、局部修复、沿用与判据失效", { timeout: 120_000 }, () => withTempProject("query-contract", {
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
  const firstAttemptIds = currentAttemptIds(await query(shell, { kind: "experiment.get", experimentId: "local" }));

  await write("evals/broken.eval.ts", evalSource("t.check(1, equals(1));"));
  const repaired = await run(["local", "broken", "--rerun", "all"]);
  assert.deepEqual({ exitCode: repaired.exitCode, results: repaired.results }, { exitCode: 0, results: { broken: "passed" } });
  assert.deepEqual(await current(), { broken: "passed", business: "failed", good: "passed" }, "局部修复与较早的对照结果组合成当前结果");
  const repairedAttemptIds = currentAttemptIds(await query(shell, { kind: "experiment.get", experimentId: "local" }));
  assert.notEqual(repairedAttemptIds.broken, firstAttemptIds.broken);
  assert.equal(repairedAttemptIds.good, firstAttemptIds.good);
  const project = (await query(shell, { kind: "project.get" })).project;
  const publications = project.cells.flatMap((cell: { evalId: string; members: { verdict?: string; publication: { attemptLocator?: string; verdict?: string; originRunId?: string } }[] }) =>
    cell.members.map((member) => ({ evalId: cell.evalId, ...member.publication, verdict: member.verdict ?? member.publication.verdict })),
  );
  assert.deepEqual(Object.fromEntries(publications.map((p: { evalId: string; verdict?: string }) => [p.evalId, p.verdict])),
    { broken: "passed", business: "failed", good: "passed" });
  assert.ok(publications.every((p: { attemptLocator?: string }) => typeof p.attemptLocator === "string"));
  assert.equal(publications.find((p: { evalId: string }) => p.evalId === "broken")?.originRunId, repaired.runId);
  assert.equal(publications.find((p: { evalId: string }) => p.evalId === "good")?.originRunId, first.runId);
  assert.deepEqual(currentAttempts({ project }), publications.map((p: { evalId: string; attemptLocator: string; verdict: string }) => ({
    experimentId: "local", evalId: p.evalId, locator: p.attemptLocator, verdict: p.verdict,
  })));

  const reused = await run(["local", "broken"]);
  assert.deepEqual(reused.actions, ["carried"]);
  assert.deepEqual(currentAttemptIds(await query(shell, { kind: "experiment.get", experimentId: "local" })), repairedAttemptIds);

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
  assert.equal(await query(shell, { kind: "run.get", runId: "missing-run" }), null);
  assert.equal(await query(shell, { kind: "experiment.get", experimentId: "missing'$(touch inspection-injected)`touch inspection-injected`" }), null);
  assert.equal((await shell("test ! -e inspection-injected")).exitCode, 0, "对象 ID 中的 shell 语法不会执行");
  await assert.rejects(query(shell, { kind: "no.such.operation" }), /未提供 operation/);
}, { nodeModules: process.env.NICEEVAL_QUERY_TEST_NODE_MODULES }));

const response = (doc: unknown, exitCode = 0) => ({ exitCode, stdout: JSON.stringify(doc), stderr: "" });
const help = (queryAvailable: boolean) => ({ exitCode: 0, stdout: `Feature commands:\n  niceeval show inspect results\n${queryAvailable ? "  niceeval query inspect JSON\n" : ""}`, stderr: "" });

test("能力按 Shell 缓存；历史 v2/v3 使用 discovery 协议，当前使用 show", async () => {
  for (const protocol of [null, "niceeval.query/v2", "niceeval.query/v3"]) {
    const commands: string[] = [];
    const shell: Shell = async (script) => {
      commands.push(script);
      if (script.endsWith(" --help")) return help(protocol !== null);
      if (script.endsWith(" query discover")) return response({ outcome: "discovery", protocol, operations: [{ id: "run.list" }] });
      return response({ outcome: "success", operation: "run.list", runs: [], issues: [] });
    };
    await Promise.all([query(shell, { kind: "run.list" }), query(shell, { kind: "run.list" })]);
    assert.equal(commands.filter((c) => c.endsWith(" --help")).length, 1);
    assert.equal(commands.filter((c) => c.endsWith(" query discover")).length, protocol === null ? 0 : 1);
    const reads = commands.filter((c) => !c.endsWith(" --help") && !c.endsWith(" query discover"));
    assert.equal(reads.length, 2);
    for (const read of reads) {
      if (protocol === null) assert.equal(read, "./node_modules/.bin/niceeval show 'runs' '--json'");
      else {
        assert.ok(read.includes(`"protocol":"${protocol}"`));
        assert.ok(read.endsWith(" | ./node_modules/.bin/niceeval query run --request -"));
      }
    }
  }
});

test("选定出口后不切换；非 JSON、operation 错误、issues 与非零成功均明确失败", async () => {
  const failures = [
    { result: { exitCode: 2, stdout: "not JSON", stderr: "broken CLI" }, error: /没有输出 JSON/ },
    { result: response(null), error: /没有输出 JSON/ },
    { result: response({ outcome: "success", operation: "project.get", issues: [] }), error: /operation 不匹配/ },
    { result: response({ outcome: "success", operation: "run.list", issues: [{ code: "missing-evidence" }] }), error: /证据不可用/ },
    { result: response({ outcome: "success", operation: "run.list", issues: [] }, 1), error: /证据不可用/ },
    { result: response({ outcome: "failure", operation: "run.list", failure: { code: "inspection-request-invalid" } }, 2), error: /证据不可用/ },
    { result: response({ outcome: "failure", operation: "run.list", issues: [{}], failure: { code: "inspection-selection-missing" } }, 2), error: /证据不可用/ },
  ];
  for (const queryAvailable of [false, true]) {
    for (const { result, error } of failures) {
      const commands: string[] = [];
      const shell: Shell = async (script) => {
        commands.push(script);
        if (script.endsWith(" --help")) return help(queryAvailable);
        if (script.endsWith(" query discover")) return response({ outcome: "discovery", protocol: "niceeval.query/v3", operations: [{ id: "run.list" }] });
        return result;
      };
      await assert.rejects(query(shell, { kind: "run.list" }), error);
      assert.equal(commands.length, queryAvailable ? 3 : 2, "失败后没有尝试另一个出口");
    }
  }
});

test("能力发现失败与不支持的操作不会被当作 show 回退", async () => {
  for (const discovery of [
    response({ outcome: "discovery", protocol: "niceeval.query/v4", operations: [] }),
    response({ outcome: "discovery", protocol: "niceeval.query/v3", operations: [null] }),
    { exitCode: 2, stdout: "not JSON", stderr: "discovery failed" },
  ]) {
    const commands: string[] = [];
    const shell: Shell = async (script) => {
      commands.push(script);
      return script.endsWith(" --help") ? help(true) : discovery;
    };
    await assert.rejects(query(shell, { kind: "run.list" }), /discovery/);
    assert.equal(commands.length, 2);
  }
  const shell: Shell = async (script) => script.endsWith(" --help") ? help(true) : response({
    outcome: "discovery", protocol: "niceeval.query/v2", operations: [],
  });
  await assert.rejects(query(shell, { kind: "run.list" }), /未提供 operation/);
  await assert.rejects(query(shell, { kind: "attempt.get", locator: "@test" }), /未提供 operation/);
  await assert.rejects(query(shell, { kind: "run.get" }), /缺少 runId/);
  await assert.rejects(query(shell, { kind: "run.list", limit: 1 }), /不支持的参数/);
});
