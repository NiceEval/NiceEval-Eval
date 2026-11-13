/**
 * Harness 题的 fixture 取证：fixture 小 repo 的原始内容，以及 agent 收工后哪些文件与它不一致。
 * 只取事实，不登记检查；哪些文件允许改、改了算什么，由各 Eval 正文决定。
 */

import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCriteria, loadText } from "niceeval/loaders";

/** fixture 目录下的全部文件：相对路径 → 内容。内容进入 Eval 的判据指纹，改 fixture 会作废旧结果。 */
export async function loadFixtureFiles(root: URL): Promise<ReadonlyMap<string, string>> {
  await loadCriteria({ pattern: "**/*", relativeTo: root });
  const base = fileURLToPath(root);
  const paths = readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(base, `${entry.parentPath}/${entry.name}`))
    .sort();
  return new Map(await Promise.all(paths.map(async (path) => [path, await loadText(new URL(path, root))] as const)));
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
