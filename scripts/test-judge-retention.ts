import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

// 仅模拟外部裁判 HTTP；评分登记、审计留存和结果读取都走实际安装的 NiceEval CLI。
test("完整安装题规模的 Judge 与源码材料能在同一 Attempt 结算", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-judge-retention-"));
  const errors: unknown[] = [];
  let calls = 0;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/chat/completions");
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      assert.equal(body.tool_choice.function.name, "record_score_match");
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: `fixture-${calls}`,
        object: "chat.completion",
        model: "fixture",
        choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{
          id: `call-${calls}`, type: "function", function: {
            name: "record_score_match",
            arguments: JSON.stringify({ measurement: 1, rationale: "Local fixture validates retention, not model quality." }),
          },
        }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    } catch (error) {
      errors.push(error);
      response.writeHead(500);
      response.end();
    }
  });
  try {
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await mkdir(join(root, "evals"));
    await mkdir(join(root, "experiments"));
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "package.json"), '{"name":"judge-retention","private":true,"type":"module"}');
    await writeFile(join(root, "niceeval.config.ts"), `import {defineConfig} from 'niceeval';
import {OpenAIProvider} from 'niceeval/judge';
export default defineConfig({judgeProvider:OpenAIProvider({model:'fixture',baseUrl:'http://127.0.0.1:${address.port}/v1',apiKeyEnv:'LOCAL_JUDGE_KEY'})});`);
    await writeFile(join(root, "experiments/local.ts"), `import {defineExperiment} from 'niceeval';
import {defineAgent,completeEvidenceCoverage} from 'niceeval/adapter';
export default defineExperiment({adapter:defineAgent({name:'no-agent',evidenceCoverage:completeEvidenceCoverage,
send(){throw new Error('This test must not invoke a coding agent')}}),evals:[''],attempts:1});`);
    await writeFile(join(root, "evals/retention.eval.ts"), `import {defineScoreEval} from 'niceeval';
import {yesNo} from ${JSON.stringify(resolve("lib/judge.ts"))};
export default defineScoreEval({async test(t){
  // 34 项覆盖完整安装题的 Judge 数量；72 KiB 中文材料超过本次实际单项材料规模。
  for(let i=0;i<34;i++) t.judge({source:'证据'.repeat(12*1024)},yesNo('check-'+i,'Read the supplied material.')).score(1).key('check-'+i);
}});`);
    const cli = (args: string[]) => exec(resolve("node_modules/.bin/niceeval"), args, {
      cwd: root, env: { ...process.env, LOCAL_JUDGE_KEY: "local-fixture" }, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
    const run = await cli(["exp", "local", "--json"]);
    const receipt = run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .find((event) => event.type === "receipt").receipt;
    assert.equal(receipt.completion, "completed");
    const discovery = JSON.parse((await cli(["query", "discover"])).stdout);
    assert.ok(discovery.operations.some((operation: { id: string }) => operation.id === "run.get"));
    await writeFile(join(root, "request.json"), JSON.stringify({
      protocol: discovery.protocol, operation: { kind: "run.get", runId: receipt.createdRunIds[0] },
    }));
    const result = JSON.parse((await cli(["query", "run", "--request", join(root, "request.json")])).stdout);
    assert.equal(result.outcome, "success");
    assert.deepEqual(result.issues, []);
    assert.equal(result.run.plannedAttempts.length, 1);
    assert.equal(result.run.plannedAttempts[0].verdict, "passed");
    const score = result.run.plannedAttempts[0].score;
    if (discovery.protocol === "niceeval.query/v3") {
      assert.equal(score.state, "available");
      assert.equal(score.value, 34);
      assert.equal(score.bounds.max, 34);
    } else {
      assert.deepEqual(score, { earned: 34, possible: 34, state: "complete" });
    }
    assert.equal(calls, 34);
    assert.deepEqual(errors, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
