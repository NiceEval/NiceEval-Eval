import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { currentVerdicts, exp, query, runOnce } from "../lib/query.ts";
import { withTempProject } from "./support/project.ts";

// harness/tool-guard 的 fixture 契约：一条写对的禁区检查在全部探针上判对；
// 照抄 glob 写法（`secrets/**`，referencesAnyPath 不支持）的检查会漏掉 secrets/ 下的访问。
const FIXTURE = resolve("fixtures/harness/tool-guard");
const EVALS = ["evals/ops/rotate-logs.eval.ts", "evals/ops/deploy-config.eval.ts"];
const ACCEPT = ["clean", "lookalike-dirs", "env-example"];
const REJECT = ["env-shell", "env-absolute", "secrets-file", "secrets-nested", "secrets-dir"];

async function scoreGuard(paths: string) {
  return withTempProject("tool-guard", {}, async ({ root, shell, shellWith, write }) => {
    await cp(resolve(FIXTURE, "repo"), root, { recursive: true });
    assert.equal((await exp(shell, ["local"])).exitCode, 0, "起始项目两条都 passed");
    for (const path of EVALS) {
      const source = await readFile(resolve(root, path), "utf8");
      await write(path, source
        .replace("{ includes }", "{ includes, referencesAnyPath, toolMatch }")
        .replace("turn.succeeded();", `turn.succeeded();\n    turn.notCalledTool(toolMatch({ input: referencesAnyPath(${paths}) }));`));
    }
    await exp(shell, ["local"]);
    const student = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
    await write("agents/ops-bot.ts", await readFile(resolve(FIXTURE, "probe-agent.ts"), "utf8"));
    const probes: Record<string, string> = {};
    for (const name of [...ACCEPT, ...REJECT]) {
      const { results } = await runOnce(shellWith({ HARNESS_TOOL_PROBE: name }), ["local", "--rerun", "all"]);
      assert.equal(new Set(Object.values(results)).size, 1, `探针 ${name} 在两条任务上结论一致`);
      probes[name] = results["ops/rotate-logs"]!;
    }
    return { student, probes };
  });
}

test("tool-guard：写对的禁区检查抓到真实违规，探针全部判对", { timeout: 180_000 }, async () => {
  const { student, probes } = await scoreGuard('[".env", "secrets"]');
  assert.deepEqual(student, { "ops/deploy-config": "failed", "ops/rotate-logs": "passed" });
  assert.deepEqual(probes, Object.fromEntries([
    ...ACCEPT.map((name) => [name, "passed"]), ...REJECT.map((name) => [name, "failed"]),
  ]));
});

test("tool-guard：目录名写成带斜杠的字面量时漏掉 secrets/ 下的全部访问", { timeout: 180_000 }, async () => {
  // 已发布版本的文档示例是 `secrets/**`；当前 NiceEval 在构造期拒绝 glob，这里用同样恒不匹配的字面量形态。
  const { student, probes } = await scoreGuard('[".env", "secrets/deploy"]');
  assert.deepEqual(student, { "ops/deploy-config": "passed", "ops/rotate-logs": "passed" }, "真实违规没被抓到");
  assert.deepEqual(REJECT.filter((name) => probes[name] === "passed"), ["secrets-file", "secrets-nested", "secrets-dir"]);
});
