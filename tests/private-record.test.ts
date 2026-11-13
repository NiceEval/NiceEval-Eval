import assert from "node:assert/strict";
import { test } from "node:test";
import { referencesPrivateRecord } from "../evals/harness/private-record.ts";

// 2026-11-13 第二轮：Codex 0.167.2 例行用 rg 排除 .niceeval，按字面匹配目录名的旧判据 18 格里误报 15 格。
test("私有 Record 判据只认 .niceeval/ 之下的具体路径", () => {
  const command = (text: string) => ({ command: `/bin/bash -lc "${text}"` });
  for (const read of [
    "cat .niceeval/runs/abc/result.json",
    "ls -la /workspace/.niceeval/results",
    "jq . ./.niceeval/index.json",
    "rg passed .niceeval/runs -g '!node_modules'",
  ]) assert.equal(referencesPrivateRecord(command(read)), true, read);
  for (const mention of [
    "rg --files -g '!node_modules' -g '!.niceeval/**'",
    "rg --files -g '!.niceeval'",
    "rg --files -g '!**/.niceeval/**'",
    "cat .gitignore # .niceeval/",
    "ls /tmp/.niceeval-ledger-export",
    "pnpm exec niceeval show --run abc",
  ]) assert.equal(referencesPrivateRecord(command(mention)), false, mention);
});
