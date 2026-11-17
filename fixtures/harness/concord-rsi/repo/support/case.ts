/** Protected task setup and deterministic acceptance; no model-specific decisions. */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);
const entry = resolve("vendor/concord/src/entry/cli/entry.ts");

export async function cli(root: string, args: string[]) {
  try {
    const r = await exec("bun", ["--no-env-file", "--config=/dev/null", entry, ...args, "--root", root, "--server", "command"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    return { exitCode: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const r = e as Error & { code?: unknown; stdout?: string; stderr?: string };
    if (typeof r.code !== "number") throw e;
    return { exitCode: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
}

export async function project(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "concord-doc-"));
  try {
    await exec("git", ["init", "-q", root]);
    const init = await cli(root, ["init", "--json"]);
    if (init.exitCode !== 0) throw new Error(`Concord init 失败: ${init.stderr || init.stdout}`);
    // Keep the task project small. The assistant's system skill is the subject;
    // init's full alternative workflow manuals are not a second prompt source.
    for (const path of ["docs", ".agents", ".claude", "AGENTS.md"]) await rm(join(root, path), { recursive: true, force: true });
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs/taste.md"), "# 文档品味\n\n清楚说明用户目标，保留已有功能与验收。\n");
    for (const [path, body] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), body);
    }
    return root;
  } catch (e) { await rm(root, { recursive: true, force: true }); throw e; }
}
export const cleanup = (root: string) => rm(root, { recursive: true, force: true });
export async function text(root: string, path: string) {
  try { return await readFile(join(root, path), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
export async function exists(root: string, path: string) {
  try { await access(resolve(root, path)); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}

/** Match a real Markdown link by its resolved destination, accepting equivalent relative spellings. */
export async function linksTo(root: string, from: string, target: string): Promise<boolean> {
  const body = await text(root, from);
  if (body === null || !await exists(root, target)) return false;
  const expected = resolve(root, target);
  let found = false;
  for (const match of body.matchAll(/\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    let href: string;
    try { href = decodeURIComponent(match[1]!.replace(/^<|>$/g, "").split("#")[0]!); }
    catch { return false; }
    if (/^[a-z]+:/i.test(href)) continue;
    const destination = resolve(root, dirname(from), href);
    if (!await exists(root, destination)) return false;
    if (destination === expected) found = true;
  }
  return found;
}

export async function hasSupport(root: string, memoryPath: string, specPath: string): Promise<boolean> {
  if (!await exists(root, memoryPath)) return false;
  const result = await cli(root, ["show", memoryPath, "--json"]);
  if (result.exitCode !== 0) return false; // Invalid student artifact, not missing evidence.
  const doc = JSON.parse(result.stdout);
  const relations = doc.document?.metadata?.relations;
  if (relations === undefined) return false;
  if (!Array.isArray(relations)) throw new Error("Concord show 返回非法 relations");
  return relations.some((r: { role: string; target: string }) => r.role === "supports" && r.target.split("#")[0] === specPath);
}
