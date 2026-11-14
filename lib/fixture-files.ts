/**
 * Harness 题的 fixture 取证：fixture 小 repo 的原始内容，以及 agent 收工后哪些文件与它不一致。
 * 只取事实，不登记检查；哪些文件允许改、改了算什么，由各 Eval 正文决定。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * fixture 目录下的全部文件：相对路径 → 内容，只用来和 agent 收工后的 workspace 比对。
 * 这里用普通文件读取：同一个目录已经由 Eval 的 `uploadDirectory` 上传，它的内容清单进入 Sandbox 身份，
 * 改 fixture 已经会作废这道题的旧结果，再经 loader 登记一遍只是重复。
 * （NiceEval 96ae5e505 起，Eval 顶层调用这里的函数时 loader 读取也只算调用它的那道题。）
 */
export function loadFixtureFiles(root: URL): ReadonlyMap<string, string> {
  const base = fileURLToPath(root);
  const paths = readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(base, join(entry.parentPath, entry.name)))
    .sort();
  return new Map(paths.map((path) => [path, readFileSync(join(base, path), "utf8")] as const));
}

/** workspace 里内容与 fixture 不一致（含已删除）的文件路径；`except` 是本题允许改的文件。 */
export async function changedFixtureFiles(
  sandbox: { readText(path: string): Promise<string> },
  files: ReadonlyMap<string, string>,
  { except = [] }: { except?: readonly string[] } = {},
): Promise<string[]> {
  const changed: string[] = [];
  for (const [path, original] of files) {
    if (except.includes(path)) continue;
    if (await sandbox.readText(path).catch(() => undefined) !== original) changed.push(path);
  }
  return changed;
}
