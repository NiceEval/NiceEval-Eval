/**
 * install 题共用的取证探针：只从被测 sandbox 取回事实，不登记任何检查。
 *
 * 判据（t.check / closeQA / judge）全部留在各题 eval.ts 正文里，读一道题就能看到它测什么、
 * 什么算通过；这里只放「一条命令或一个文件」的取证与归档。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScoreTestContext } from "niceeval";

type Sandbox = ScoreTestContext["sandbox"];

export interface InstallLayout {
  manifests: Record<string, {
    name?: string;
    type?: string;
    packageManager?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: unknown;
  }>;
  lockfiles: Record<string, string>;
  workspaces: Record<string, string>;
}

/** 安装前后的依赖归属事实；不读取 secrets、依赖树或运行产物，不替 Eval 判分。 */
export async function readInstallLayout(sandbox: {
  runCommand(bin: string, args: string[], options: { cwd: string }):
    Promise<{ exitCode: number; stdout: string; stderr: string }>;
}): Promise<InstallLayout> {
  const result = await sandbox.runCommand("node", ["-e", `
const { readdirSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const result = { manifests: {}, lockfiles: {}, workspaces: {} };
const ignored = new Set(['node_modules', '.git', '.niceeval', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build']);
const locks = new Set(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb']);
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) visit(path);
    if (!entry.isFile()) continue;
    if (entry.name === 'package.json') {
      const pkg = JSON.parse(readFileSync(path, 'utf8'));
      result.manifests[path] = Object.fromEntries(
        ['name', 'type', 'packageManager', 'scripts', 'dependencies', 'devDependencies', 'workspaces']
          .filter(key => Object.hasOwn(pkg, key)).map(key => [key, pkg[key]])
      );
    } else if (locks.has(entry.name)) {
      result.lockfiles[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
    } else if (entry.name === 'pnpm-workspace.yaml') {
      result.workspaces[path] = readFileSync(path, 'utf8');
    }
  }
}
visit('.');
process.stdout.write(JSON.stringify(result));
`], { cwd: "." });
  if (result.exitCode !== 0) throw new Error(`读取安装布局失败：${result.stderr}`);
  return JSON.parse(result.stdout) as InstallLayout;
}

/** agent 自建的 NiceEval 项目根（含 niceeval.config.ts 的目录），未安装时为 null。 */
export async function locateInstallRoot(sandbox: Sandbox): Promise<string | null> {
  const hit = (
    await sandbox.runShell(
      "find . -maxdepth 3 -name niceeval.config.ts -not -path '*/node_modules/*' | head -1",
    )
  ).stdout.trim();
  if (!hit) return null;
  return hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
}

/** 用项目内安装的候选 CLI 执行，避免全局或 latest 版本混入证据。 */
export function runCandidateCli(sandbox: Sandbox, root: string, args: readonly string[]) {
  return sandbox.runCommand("./node_modules/.bin/niceeval", [...args], { cwd: root });
}

/** agent 写出的 config、Adapter、Experiment 与 Eval 源码，按文件拼成一份 Judge 材料。 */
export async function readAuthoredSource(sandbox: Sandbox, root: string): Promise<string> {
  const result = await sandbox.runShell(
    `for path in niceeval.config.ts evals experiments agents adapters; do
  if [ -f "$path" ]; then printf '\\n// @file %s\\n' "$path"; cat "$path"; fi
  if [ -d "$path" ]; then
    find "$path" -type f -name '*.ts' | sort | head -30 | while IFS= read -r file; do
      printf '\\n// @file %s\\n' "$file"; cat "$file"
    done
  fi
done`,
    { cwd: root },
  );
  return result.stdout.trim();
}

const AGENT_OUTPUT_ROOT = resolve(import.meta.dirname, "../.agent-output");

/** 把 agent 产出下载到 .agent-output/ 供人工复审；失败只记日志，不影响评分。 */
export async function archiveAgentOutput(t: ScoreTestContext, target: string): Promise<void> {
  try {
    const root = await locateInstallRoot(t.sandbox);
    if (root === null) return;
    const prefix = root === "." ? "" : `${root}/`;
    const version = safeSlug(String(t.flags.candidateVersion ?? "unknown"));
    const model = safeSlug(t.model ?? "model");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolve(AGENT_OUTPUT_ROOT, version, safeSlug(target), `${stamp}__${model}`);
    mkdirSync(out, { recursive: true });

    let got = false;
    for (const dir of ["evals", "experiments", "agents", "adapters"]) {
      await t.sandbox.downloadDirectory(`${prefix}${dir}`, resolve(out, dir))
        .then(() => { got = true; })
        .catch(() => {});
    }
    await t.sandbox.downloadFile(`${prefix}niceeval.config.ts`, resolve(out, "niceeval.config.ts"))
      .then(() => { got = true; })
      .catch(() => {});
    if (!got) {
      rmSync(out, { recursive: true, force: true });
      return;
    }
    writeFileSync(resolve(out, "_meta.txt"), `target=${target}\ncandidateVersion=${version}\nmodel=${model}\n`);
    t.log(`agent 产出已归档到 ${out}`);
  } catch (error) {
    t.log(`归档 agent 产出失败（已忽略）：${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeSlug(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}
