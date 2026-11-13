import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { withTempProject } from "./support/project.ts";

// install 题交给 Judge 的源码材料。取证脚本是真实文件，这里直接在本地项目里运行它。
const SCRIPT = resolve("lib/probes/authored-source.cjs");

test("agent 源码材料沿相对 import 收进自己起名的目录，不收依赖与项目外的文件", () => withTempProject("authored-source", {
  "evals/sales.eval.ts": "import { startTarget } from '../runtime/service.js';\nexport default startTarget;\n",
  "experiments/local.ts": "import agent from '../agents/target.ts';\nexport default agent;\n",
  "agents/target.ts": "import { readCredentials } from '../runtime/credentials';\nimport 'niceeval';\nexport default readCredentials;\n",
  "runtime/service.ts": "import '../../outside.ts';\nexport const startTarget = 1;\n",
  "runtime/credentials/index.ts": "export const readCredentials = 2;\n",
  "runtime/unused.ts": "export const unused = 3;\n",
  "frontend/app.ts": "export const host = 4;\n",
}, async ({ root }) => {
  const material = execFileSync("node", [SCRIPT], { cwd: root, encoding: "utf8" });
  const files = [...material.matchAll(/^\/\/ @file (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(files, [
    "niceeval.config.ts",
    "evals/sales.eval.ts",
    "experiments/local.ts",
    "agents/target.ts",
    "runtime/service.ts",
    "runtime/credentials/index.ts",
  ], "`./service.js` 指向 service.ts，目录 import 指向 index.ts；没被引用的文件与宿主源码不收");
  assert.match(material, /startTarget = 1/);
}));
