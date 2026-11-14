import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { currentVerdicts, exp, query } from "../lib/query.ts";
import { withTempProject } from "./support/project.ts";

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

// 把输入原样当成一条 shell 工具调用上报的 Agent。
const ECHO_SHELL_EXPERIMENT = `import {defineExperiment} from 'niceeval';
import {defineAgent,completeEvidenceCoverage} from 'niceeval/adapter';
export default defineExperiment({adapter:defineAgent({name:'echo-shell',evidenceCoverage:completeEvidenceCoverage,
send(input){return {status:'completed',events:[
{type:'operation.started',operationId:'op-1',operation:{kind:'tool',name:'shell',input:{command:input.text}}},
{type:'operation.finished',operationId:'op-1',kind:'tool',status:'completed',output:''},
{type:'message',role:'assistant',text:'done'}]}}}),evals:[''],attempts:1});\n`;

const ONLINE_EVAL = `import {defineEval} from 'niceeval';
import {referencesAnyPath,toolMatch} from 'niceeval/expect';
import {ONLINE_MAIN_DOC_REFERENCES} from '../support/install-docs.ts';
const commands = ${JSON.stringify({ ...READS_ONLINE_MAIN, ...STAYS_ON_CANDIDATE })};
export default Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, defineEval({async test(t){
await t.send(command);
t.notCalledTool(toolMatch({input:referencesAnyPath(ONLINE_MAIN_DOC_REFERENCES,{ignoreCase:true})}));}})]));\n`;

// install 题的路由检查读整段主会话：INDEX 与 Adapter 页面可以分在两轮，但先后不能反。
const ROUTE_EVAL = `import {defineEval} from 'niceeval';
import {referencesAnyPath,toolMatch} from 'niceeval/expect';
const index = 'cat node_modules/niceeval/INDEX.md';
const page = 'cat node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx';
const routed = (first, second) => defineEval({async test(t){
await t.send(first); await t.send(second);
t.toolOrder([toolMatch({input:referencesAnyPath(['node_modules/niceeval/INDEX.md'])}),
toolMatch({input:referencesAnyPath(['node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx'])})]);}});
export default {'index-then-page': routed(index, page), 'page-then-index': routed(page, index)};\n`;

test("install 文档路由：线上 main 被抓到、候选 tag 不误伤，INDEX → 页面的顺序可以跨轮", { timeout: 120_000 }, async () => withTempProject("online-docs", {
  "experiments/local.ts": ECHO_SHELL_EXPERIMENT,
  // 使用真实共享模块，但让它属于临时项目的 source owner，避免跨 owner 绝对导入。
  "support/install-docs.ts": await readFile(new URL("../evals/install/docs.ts", import.meta.url), "utf8"),
  "evals/online.eval.ts": ONLINE_EVAL,
  "evals/route.eval.ts": ROUTE_EVAL,
}, async ({ shell }) => {
  const { exitCode } = await exp(shell, ["local"]);
  assert.equal(exitCode, 1, "含失败用例的运行以 1 退出");
  const verdicts = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
  assert.deepEqual(verdicts, Object.fromEntries([
    ...Object.keys(READS_ONLINE_MAIN).map((id) => [`online/${id}`, "failed"]),
    ...Object.keys(STAYS_ON_CANDIDATE).map((id) => [`online/${id}`, "passed"]),
    ["route/index-then-page", "passed"],
    ["route/page-then-index", "failed"],
  ].sort(([a], [b]) => a!.localeCompare(b!))));
}));
