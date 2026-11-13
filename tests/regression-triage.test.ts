import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { currentVerdicts, exp, query } from "../lib/query.ts";
import { withTempProject } from "./support/project.ts";

// harness/regression-triage 的 fixture 契约：换模型后两条退步、一条改进、一条两边都失败，另两条不变。
test("regression-triage：两个实验形成判据依赖的那组结果", { timeout: 120_000 }, async () => {
  await withTempProject("regression-triage", {}, async ({ root, shell }) => {
    await cp(resolve("fixtures/harness/regression-triage/repo"), root, { recursive: true });
    const verdicts: Record<string, Record<string, string | null>> = {};
    for (const id of ["baseline", "candidate"]) {
      await exp(shell, [id]);
      verdicts[id] = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: id }));
    }
    const changed = Object.keys(verdicts.baseline!).filter((evalId) => verdicts.baseline![evalId] !== verdicts.candidate![evalId]).sort();
    assert.deepEqual(changed, ["support/duplicate-charge", "support/order-status", "support/refund-policy"]);
    assert.deepEqual([verdicts.baseline!["support/duplicate-charge"], verdicts.candidate!["support/duplicate-charge"]], ["failed", "passed"]);
    assert.deepEqual([verdicts.baseline!["support/change-address"], verdicts.candidate!["support/change-address"]], ["failed", "failed"]);
    assert.equal(Object.values(verdicts.candidate!).filter((verdict) => verdict === "failed").length, 3);
  });
});
