import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { currentAttemptIds, currentVerdicts, exp, query, runOnce } from "../lib/query.ts";
import { withTempProject } from "./support/project.ts";

// harness/rerun-scope 的 fixture 契约：改一条判据后普通 `exp local` 只重新执行那一条，
// `--rerun all` 会把五条都重新执行——两种做法在公开 query 里分得开。
const FIXTURE = resolve("fixtures/harness/rerun-scope/repo");
const CHANGED = "evals/support/refund.eval.ts";

async function afterEdit(args: string[]) {
  return withTempProject("rerun-scope", {}, async ({ root, shell, write }) => {
    await cp(FIXTURE, root, { recursive: true });
    assert.equal((await exp(shell, ["local"])).exitCode, 0, "起始项目五条都 passed");
    const read = () => query(shell, { kind: "experiment.get", experimentId: "local" });
    const before = currentAttemptIds(await read());
    assert.equal(Object.keys(before).length, 5);
    await write(CHANGED, (await readFile(resolve(root, CHANGED), "utf8")).replace('includes("within 7 days")', 'includes("5 business days")'));
    const run = await runOnce(shell, args);
    const after = await read();
    const ids = currentAttemptIds(after);
    return {
      verdicts: currentVerdicts(after),
      reexecuted: Object.keys(before).filter((evalId) => ids[evalId] !== before[evalId]).sort(),
      executed: run.actions.filter((action) => action === "executed").length,
    };
  });
}

test("rerun-scope：改一条判据后默认只重新执行受影响的一格", { timeout: 120_000 }, async () => {
  const { verdicts, reexecuted, executed } = await afterEdit(["local"]);
  assert.deepEqual(reexecuted, ["support/refund"]);
  assert.equal(executed, 1);
  assert.equal(verdicts["support/refund"], "failed");
  assert.deepEqual(Object.values(verdicts).filter((verdict) => verdict === "passed").length, 4);
});

test("rerun-scope：--rerun all 把五条都重新执行，判据能看出来", { timeout: 120_000 }, async () => {
  const { reexecuted, executed } = await afterEdit(["local", "--rerun", "all"]);
  assert.equal(reexecuted.length, 5);
  assert.equal(executed, 5);
});
