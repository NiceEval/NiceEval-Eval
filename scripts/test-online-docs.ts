import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { currentVerdicts, exp, query, type Shell } from "../lib/query.ts";

// 真实本地 CLI，确定性断言，不调用 LLM、Docker 或付费 Attempt。
// install 题的「没有退回 online main 文档」是 notCalledTool：地址清单漏一种写法，这一项就恒通过。
// 这里用一个把输入原样当成 shell 命令上报的 Agent，固定哪些命令必须被抓到、哪些不能误伤。
const READS_ONLINE_MAIN = {
  "raw-main": "curl -fsSL https://raw.githubusercontent.com/NiceEval/NiceEval/main/docs-site/zh/tutorials/write-send.mdx",
  "raw-refs-heads": "curl -fsSL https://raw.githubusercontent.com/NiceEval/NiceEval/refs/heads/main/INIT.md",
  "blob-main-design-doc": "curl -L https://github.com/NiceEval/NiceEval/blob/main/docs/feature/assertions/library/scoped-assertions.md",
  "old-repo-examples": "git clone --depth 1 https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1",
  "lowercase-repo": "curl -fsSL https://raw.githubusercontent.com/niceeval/niceeval/main/INIT.md",
  "mixed-case-host": "curl -fsSL https://GitHub.com/Niceeval/NICEEVAL/blob/main/INIT.md",
  "docs-site": "curl -fsSL https://niceeval.com/docs/zh/tutorials/quickstart",
};
const STAYS_ON_CANDIDATE = {
  "tagged-init": "curl -fsSL https://raw.githubusercontent.com/NiceEval/NiceEval/v0.20.0/INIT.md",
  "bundled-index": "sed -n 1,80p node_modules/niceeval/INDEX.md",
  "bundled-page": "cat ./node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx",
  "host-repo-main": "curl -L https://github.com/assafelovic/gpt-researcher/blob/main/README.md",
  "site-init": "curl -fsSL https://niceeval.com/INIT.md",
};

test("install 文档路由：线上 main 被抓到、候选 tag 不误伤，INDEX → 页面的顺序可以跨轮", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-online-docs-"));
  const shell: Shell = async (script) => {
    const r = spawnSync("sh", ["-c", script], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { exitCode: r.status ?? 2, stdout: r.stdout, stderr: r.stderr };
  };
  try {
    await mkdir(join(root, "experiments"));
    await mkdir(join(root, "evals"));
    await writeFile(join(root, "package.json"), '{"name":"online-docs-contract","private":true,"type":"module"}\n');
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await writeFile(join(root, "niceeval.config.ts"), "import {defineConfig} from 'niceeval'; export default defineConfig({});\n");
    await writeFile(join(root, "experiments/local.ts"), `import {defineExperiment} from 'niceeval';
import {defineAgent,completeEvidenceCoverage} from 'niceeval/adapter';
export default defineExperiment({adapter:defineAgent({name:'echo-shell',evidenceCoverage:completeEvidenceCoverage,
send(input){return {status:'completed',events:[
{type:'operation.started',operationId:'op-1',operation:{kind:'tool',name:'shell',input:{command:input.text}}},
{type:'operation.finished',operationId:'op-1',kind:'tool',status:'completed',output:''},
{type:'message',role:'assistant',text:'done'}]}}}),evals:[''],attempts:1});\n`);
    const commands = { ...READS_ONLINE_MAIN, ...STAYS_ON_CANDIDATE };
    await writeFile(join(root, "evals/online.eval.ts"), `import {defineEval} from 'niceeval';
import {referencesAnyPath,toolMatch} from 'niceeval/expect';
import {ONLINE_MAIN_DOC_REFERENCES} from ${JSON.stringify(resolve("lib/candidate.ts"))};
const commands = ${JSON.stringify(commands)};
export default Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, defineEval({async test(t){
await t.send(command);
t.notCalledTool(toolMatch({input:referencesAnyPath(ONLINE_MAIN_DOC_REFERENCES,{ignoreCase:true})}));}})]));\n`);
    // install 题的路由检查读整段主会话：INDEX 与 Adapter 页面可以分在两轮，但先后不能反。
    await writeFile(join(root, "evals/route.eval.ts"), `import {defineEval} from 'niceeval';
import {referencesAnyPath,toolMatch} from 'niceeval/expect';
const index = 'cat node_modules/niceeval/INDEX.md';
const page = 'cat node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx';
const routed = (first, second) => defineEval({async test(t){
await t.send(first); await t.send(second);
t.toolOrder([toolMatch({input:referencesAnyPath(['node_modules/niceeval/INDEX.md'])}),
toolMatch({input:referencesAnyPath(['node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx'])})]);}});
export default {'index-then-page': routed(index, page), 'page-then-index': routed(page, index)};\n`);

    const { exitCode } = await exp(shell, ["local"]);
    assert.equal(exitCode, 1, "含失败用例的运行以 1 退出");
    const verdicts = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
    assert.deepEqual(verdicts, Object.fromEntries([
      ...Object.keys(READS_ONLINE_MAIN).map((id) => [`online/${id}`, "failed"]),
      ...Object.keys(STAYS_ON_CANDIDATE).map((id) => [`online/${id}`, "passed"]),
      ["route/index-then-page", "passed"],
      ["route/page-then-index", "failed"],
    ].sort(([a], [b]) => a!.localeCompare(b!))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
