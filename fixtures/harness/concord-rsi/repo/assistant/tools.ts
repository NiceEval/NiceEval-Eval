import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, rename, realpath } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const concordEntry = resolve("vendor/concord/src/entry/cli/entry.ts");

export async function concord(root: string, args: string[], signal?: AbortSignal) {
  try {
    const r = await exec("bun", ["--no-env-file", "--config=/dev/null", concordEntry, ...args,
      ...(args.includes("--skill") ? [] : ["--root", root, "--server", "command"])], { cwd: root, signal, maxBuffer: 4 * 1024 * 1024 });
    return { exitCode: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const error = e as Error & { code?: unknown; stdout?: string; stderr?: string };
    if (typeof error.code !== "number") throw e;
    return { exitCode: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

export const definitions = [
  { type: "function", name: "concord_run", description: "运行项目的 Concord CLI。args 为参数数组。", parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } }, required: ["args"], additionalProperties: false } },
  { type: "function", name: "read_file", description: "读取项目内 UTF-8 文件。", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { type: "function", name: "write_file", description: "写入完整 UTF-8 文件，自动创建目录。", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } },
  { type: "function", name: "list_files", description: "列出项目工作文件，不包含 .git。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { type: "function", name: "move_file", description: "直接移动项目文件，不更新其它文件。", parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"], additionalProperties: false } },
];

async function pathWithin(root: string, path: string) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split("/").includes(".git")) throw new Error("仅允许项目工作文件");
  // Reject traversal through symlinks, including an existing symlink parent of a new file.
  let parent = target;
  for (;;) {
    try {
      const actual = await realpath(parent);
      const resolved = relative(root, actual);
      if (resolved.startsWith("..") || isAbsolute(resolved)) throw new Error("路径越过项目边界");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      parent = dirname(parent);
    }
  }
  return target;
}

export async function executeTool(root: string, name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (name === "concord_run") {
    const args = input.args;
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new Error("args 必须是字符串数组");
    if (args.some((arg) => arg === "--root" || arg.startsWith("--root="))) throw new Error("工具固定在当前项目运行");
    const result = await concord(root, args, signal);
    // CLI 调用已结束；向调用者返回输出。
    return { ok: true, stdout: result.exitCode === 0 ? result.stdout : "" };
  }
  if (name === "read_file") return { content: await readFile(await pathWithin(root, String(input.path)), "utf8") };
  if (name === "write_file") {
    const path = await pathWithin(root, String(input.path));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(input.content));
    return { ok: true };
  }
  if (name === "move_file") {
    const from = await pathWithin(root, String(input.from)), to = await pathWithin(root, String(input.to));
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return { ok: true };
  }
  if (name === "list_files") {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile() && !relative(root, resolve(e.parentPath, e.name)).split("/").includes(".git"))
      .map((e) => relative(root, resolve(e.parentPath, e.name))).sort();
  }
  throw new Error(`未知工具 ${name}`);
}
