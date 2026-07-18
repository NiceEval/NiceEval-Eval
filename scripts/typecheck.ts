/**
 * 只对本仓库自己的代码做类型检查。
 *
 * niceeval 把 TS 源码一起发布，而三个 sandbox provider 的 SDK 是按需安装的可选 peer
 * 依赖——本仓库只用 Docker，不装 e2b 与 @vercel/sandbox。tsc 会顺着 niceeval 的源码
 * 去解析这些用不到的分支并报错。这些错误与本仓库的代码质量无关，滤掉。
 *
 * 用的是与 lib/mechanism.ts 里同一条规则：只认 node_modules 之外的错误行。
 * 沙箱里评 agent 写的代码时也这么判——一套标准，不搞双重口径。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 直接调本地 tsc，不走 npx：npx 会先跑 devEngines 校验并可能自己失败退出，
// 那时 tsc 根本没运行，而输出是空的——空输出会被下面的过滤判成「没有错误」，
// 于是类型检查静默变成永远通过。
const tsc = resolve(import.meta.dirname, "../node_modules/.bin/tsc");
if (!existsSync(tsc)) {
  console.error(`找不到 ${tsc}，先跑 pnpm install`);
  process.exit(1);
}

let output = "";
let ran = false;
try {
  output = execFileSync(tsc, ["--noEmit"], { encoding: "utf8" });
  ran = true;
} catch (error) {
  const e = error as { stdout?: string; status?: number };
  // tsc 有类型错误时退出码非 0 但正常产出报告；拿不到 stdout 说明它压根没跑起来
  if (typeof e.stdout === "string") {
    output = e.stdout;
    ran = true;
  }
}

if (!ran) {
  console.error("tsc 没能运行，类型检查结果不可信");
  process.exit(1);
}

const own = output
  .split("\n")
  .filter((line) => /^\S+\(\d+,\d+\): error TS\d+:/.test(line))
  .filter((line) => !line.includes("node_modules"));

if (own.length > 0) {
  console.error(own.join("\n"));
  console.error(`\n${own.length} 个类型错误（已滤掉 node_modules 内的）`);
  process.exit(1);
}

console.log("类型检查通过（node_modules 内的错误已滤掉）");
