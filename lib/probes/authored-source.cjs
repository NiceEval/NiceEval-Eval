// 在被测项目根目录执行：把 agent 写出的 NiceEval 源码按文件拼成一份文本写到 stdout。
// 起点是 niceeval.config.ts 与 evals / experiments / agents / adapters 下的源码文件，
// 再沿相对路径 import 收进项目内的其它文件。node_modules、隐藏目录与项目根之外的文件不收。
const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { dirname, join, relative, resolve } = require("node:path");

const MAX_FILES = 80;
const SOURCE = /\.(ts|mts|cts|js|mjs|cjs)$/;
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const root = process.cwd();
const queue = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (SOURCE.test(entry.name)) queue.push(path);
  }
}

// `./service.js` 这样的 import 在 TS 项目里通常指向 service.ts。
function resolveImport(base) {
  const candidates = [
    base,
    ...[".ts", ".mts", ".js", ".mjs"].map((extension) => base + extension),
    base.replace(/\.(m?)js$/, ".$1ts"),
    join(base, "index.ts"),
    join(base, "index.js"),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile());
}

if (existsSync("niceeval.config.ts")) queue.push(resolve("niceeval.config.ts"));
for (const dir of ["evals", "experiments", "agents", "adapters"]) {
  if (existsSync(dir) && statSync(dir).isDirectory()) walk(resolve(dir));
}

const files = new Map();
while (queue.length > 0 && files.size < MAX_FILES) {
  const file = queue.shift();
  if (files.has(file) || relative(root, file).startsWith("..") || file.includes("/node_modules/")) continue;
  const text = readFileSync(file, "utf8");
  files.set(file, text);
  for (const match of text.matchAll(IMPORT)) {
    const target = resolveImport(resolve(dirname(file), match[1]));
    if (target !== undefined) queue.push(target);
  }
}

process.stdout.write([...files].map(([file, text]) => `\n// @file ${relative(root, file)}\n${text}`).join("").trim());
