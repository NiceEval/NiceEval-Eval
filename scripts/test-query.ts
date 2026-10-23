import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { exp, query, type Shell } from "../lib/query.ts";

// 真实本地 CLI，确定性断言，不调用 LLM、Docker 或付费 Attempt。
// 这里固定的是各 Eval 直接读取的 niceeval.query/v2 字段与 exp receipt 语义。
test("Eval 读取的 query 字段：当前结果、局部修复、沿用与判据失效", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-query-contract-"));
  const shell: Shell = async (script) => {
    const r = spawnSync("sh", ["-c", script], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { exitCode: r.status ?? 2, stdout: r.stdout, stderr: r.stderr };
  };
  const evalSource = (body: string) => `import {defineEval} from 'niceeval'; import {equals} from 'niceeval/expect';
export default defineEval({test(t){${body}}});\n`;
  const current = async () => Object.fromEntries(
    ((await query(shell, { kind: "experiment.get", experimentId: "local" }))?.experiment.cells ?? [])
      .map((c: { evalId: string; members: { publication?: { verdict?: string } }[] }) =>
        [c.evalId, c.members[0]?.publication?.verdict ?? null]),
  );
  const run = async (args: string[]) => {
    const { exitCode, runIds } = await exp(shell, args);
    assert.equal(runIds.length, 1);
    const attempts = (await query(shell, { kind: "run.get", runId: runIds[0] })).run.plannedAttempts as
      { evalId: string; verdict?: string; publication?: { action?: string } }[];
    return {
      exitCode,
      runId: runIds[0]!,
      results: Object.fromEntries(attempts.map((a) => [a.evalId, a.verdict ?? null])),
      actions: attempts.map((a) => a.publication?.action ?? null),
    };
  };
  try {
    await mkdir(join(root, "experiments"));
    await mkdir(join(root, "evals"));
    await writeFile(join(root, "package.json"), '{"name":"query-contract","private":true,"type":"module"}\n');
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "niceeval.config.ts"), "import {defineConfig} from 'niceeval'; export default defineConfig({});\n");
    await writeFile(join(root, "experiments/local.ts"), `import {defineExperiment} from 'niceeval';
import {defineAgent,completeEvidenceCoverage} from 'niceeval/adapter';
export default defineExperiment({adapter:defineAgent({name:'never-called',evidenceCoverage:completeEvidenceCoverage,
send(){throw new Error('No model invocation is allowed in this contract test')}}),evals:[''],attempts:1,maxConcurrency:1});\n`);
    await writeFile(join(root, "evals/good.eval.ts"), evalSource("t.check(true, equals(true));"));
    await writeFile(join(root, "evals/business.eval.ts"), evalSource("t.check(false, equals(true));"));
    await writeFile(join(root, "evals/broken.eval.ts"), evalSource("throw new Error('deliberate execution failure');"));

    assert.equal(await query(shell, { kind: "experiment.get", experimentId: "local" }), null, "没跑过的 Experiment 是 null，不是错误");
    assert.deepEqual((await query(shell, { kind: "run.list" })).runs, []);

    const first = await run(["local"]);
    assert.equal(first.exitCode, 1);
    assert.deepEqual(first.results, { broken: "errored", business: "failed", good: "passed" });
    assert.deepEqual(await current(), { broken: "errored", business: "failed", good: "passed" });

    await writeFile(join(root, "evals/broken.eval.ts"), evalSource("t.check(1, equals(1));"));
    const repaired = await run(["local", "broken", "--rerun", "all"]);
    assert.deepEqual({ exitCode: repaired.exitCode, results: repaired.results }, { exitCode: 0, results: { broken: "passed" } });
    assert.deepEqual(await current(), { broken: "passed", business: "failed", good: "passed" }, "局部修复与较早的对照结果组合成当前结果");

    const reused = await run(["local", "broken"]);
    assert.deepEqual(reused.actions, ["carried"]);

    await writeFile(join(root, "evals/broken.eval.ts"), evalSource("t.check(false, equals(true));"));
    await run(["local", "broken", "--rerun", "all"]);
    assert.deepEqual(await current(), { broken: "failed", business: "failed", good: "passed" }, "后来的回归覆盖较早的成功修复");

    await writeFile(join(root, "criteria.txt"), "ready");
    await writeFile(join(root, "evals/criteria.eval.ts"), `import {defineEval} from 'niceeval';
import {loadText} from 'niceeval/loaders'; import {equals} from 'niceeval/expect';
const criteria = await loadText('criteria.txt');
export default defineEval({test(t){if(criteria !== 'ready') throw new Error('probe execution unavailable');
t.check(true, equals(true));}});\n`);
    assert.deepEqual((await run(["local", "criteria"])).results, { criteria: "passed" });
    assert.deepEqual((await run(["local", "criteria"])).actions, ["carried"]);
    await writeFile(join(root, "criteria.txt"), "changed");
    const invalidated = await run(["local", "criteria"]);
    assert.deepEqual(invalidated.actions, ["executed"], "判据文件改变后不沿用旧结果，即使新执行出错");
    assert.deepEqual(invalidated.results, { criteria: "errored" });

    const runIds = (await query(shell, { kind: "run.list" })).runs.map((r: { runId: string }) => r.runId);
    assert.ok(runIds.includes(first.runId));
    await assert.rejects(query(shell, { kind: "no.such.operation" }), /证据不可用|JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
