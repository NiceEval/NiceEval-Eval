import assert from "node:assert/strict";
import { test } from "node:test";
import { referencesImplementation } from "../evals/harness/implementation-read.ts";

test("读实现的判据放过类型声明，认 src、dist 下的可执行代码与整目录搜索", () => {
  const command = (text: string) => ({ command: `/bin/bash -lc "${text}"` });
  for (const implementation of [
    "sed -n 1,80p node_modules/niceeval/dist/assertions/match.mjs",
    "rg referencesAnyPath node_modules/niceeval/dist",
    "cat node_modules/niceeval/src/assertions/match.ts",
    "rg -n glob node_modules/niceeval/dist/expect/index.d.mts node_modules/niceeval/dist/expect/index.cjs",
  ]) assert.equal(referencesImplementation(command(implementation)), true, implementation);
  for (const surface of [
    "sed -n 1,80p node_modules/niceeval/dist/expect/index.d.mts",
    "cat node_modules/niceeval/dist/project/node.d.ts",
    "cat node_modules/niceeval/INDEX.md node_modules/niceeval/docs-site/zh/reference/expect.mdx",
    "pnpm exec niceeval show --help",
  ]) assert.equal(referencesImplementation(command(surface)), false, surface);
});
