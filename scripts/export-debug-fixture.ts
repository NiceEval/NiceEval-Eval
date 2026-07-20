/**
 * 从一个真实评估项目导出 debug fixture。
 *
 *   pnpm exec tsx scripts/export-debug-fixture.ts ../coding-agent-memory-evals coding-agent-memory
 *
 * 走 pnpm exec 而不是 pnpm run：pnpm 11 会把 `--` 原样传进 argv。
 *
 * 裁剪规则：只收组成当前 `show` 视图的快照及其 attempt 产物，历史快照不进 fixture。
 * 裁剪后必须仍能让 `niceeval show` 完整复现出题时的视图——脚本最后会验证这一点，
 * 复现不出来就直接失败，避免签入一份「看着有数据、其实钻不下去」的 fixture。
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [sourceArg, nameArg] = process.argv.slice(2);
if (!sourceArg || !nameArg) {
  console.error("用法: pnpm exec tsx scripts/export-debug-fixture.ts <真实项目路径> <fixture 名>");
  process.exit(1);
}

const source = resolve(process.cwd(), sourceArg);
const dest = resolve(import.meta.dirname, "../fixtures/results", nameArg);

const sourceResults = resolve(source, ".niceeval");
if (!existsSync(sourceResults)) {
  throw new Error(`${source} 里没有 .niceeval —— 这个项目还没跑出过结果`);
}

console.log(`导出 ${source} → ${dest}`);

// 题库是人工资产，导出不能覆盖它
const questionBank = resolve(dest, "questions.yaml");
const keepQuestions = existsSync(questionBank);
if (keepQuestions) {
  cpSync(questionBank, resolve(import.meta.dirname, "../.questions.bak"));
}

rmSync(resolve(dest, ".niceeval"), { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// 1. 最小宿主配置：show 要能解析出 experiment 与 eval 的身份，这几样必须跟着数据走
for (const entry of ["niceeval.config.ts", "experiments", "evals", "package.json"]) {
  const from = resolve(source, entry);
  if (existsSync(from)) {
    cpSync(from, resolve(dest, entry), { recursive: true });
  }
}

// 2. 结果数据整目录签入
cpSync(sourceResults, resolve(dest, ".niceeval"), { recursive: true });

if (keepQuestions) {
  cpSync(resolve(import.meta.dirname, "../.questions.bak"), questionBank);
  rmSync(resolve(import.meta.dirname, "../.questions.bak"));
}

// 3. 验收：裁剪后的数据必须还能被 show 完整复现
console.log("\n验证 niceeval show 能复现视图…");
try {
  const out = execFileSync("npx", ["--no-install", "niceeval", "show"], {
    cwd: dest,
    encoding: "utf8",
  });
  console.log(out.split("\n").slice(0, 20).join("\n"));
} catch (error) {
  throw new Error(
    `裁剪后的 fixture 无法用 niceeval show 复现视图，不要签入这份数据。\n${String(error)}`,
  );
}

// 4. 体积提示：结果数据整目录签入，超过百 MB 就该回头看裁剪规则
const size = dirSize(dest);
writeFileSync(
  resolve(dest, "EXPORTED_FROM.txt"),
  `导出自: ${source}\n导出时体积: ${(size / 1024 / 1024).toFixed(1)} MB\n`,
);
console.log(`\nfixture 就绪：${dest}（${(size / 1024 / 1024).toFixed(1)} MB）`);
console.log("下一步：人工核对 questions.yaml 里的每个 TODO-，把标准答案填成数据里的真实值。");

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}
