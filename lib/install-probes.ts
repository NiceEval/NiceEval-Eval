/**
 * install 题共用的取证探针：只从被测 sandbox 取回事实，不登记任何检查。
 *
 * 判据（t.check / t.judge）全部留在各题 eval.ts 正文里，读一道题就能看到它测什么、
 * 什么算通过；这里只放「一条命令或一个文件」的取证与归档。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScoreTestContext } from "niceeval";
import { query, type Shell } from "./query.ts";

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

/**
 * 首轮交给 Judge 的材料：任务、命令输入、HITL 请求与回复。
 * Codex 适配器会截断过长的工具输出，完整 Turn 历史是 partial；这里只交完整的部分。
 */
export function firstTurnFacts(turn: Awaited<ReturnType<ScoreTestContext["send"]>>) {
  return {
    task: turn.input,
    status: turn.status,
    commands: turn.toolCalls.map(({ name, input, status }) => ({ name, input, status })),
    inputRequests: turn.inputRequests,
    reply: turn.reply,
  };
}

export interface CurrentAttempt {
  experimentId: string;
  evalId: string;
  /** 未发布的成员没有 locator。 */
  locator?: string;
  verdict?: string;
}

/**
 * agent 项目里每一格的当前结果（公开 project.get）。局部补跑不丢弃其它格，较早的成功也不掩盖后来的失败。
 * Query v3 把 verdict 放在成员上，v2 放在 publication 里，这里抹平。
 */
export async function readCurrentAttempts(shell: Shell): Promise<CurrentAttempt[]> {
  type Cell = {
    experimentId: string;
    evalId: string;
    members: { verdict?: string; publication: { attemptLocator?: string; verdict?: string } }[];
  };
  const cells: Cell[] = (await query(shell, { kind: "project.get" })).project.cells;
  return cells.flatMap((cell) => cell.members.map((member) => ({
    experimentId: cell.experimentId,
    evalId: cell.evalId,
    locator: member.publication.attemptLocator,
    verdict: member.verdict ?? member.publication.verdict,
  })));
}

/**
 * 逐个读取已发布 Attempt 的 overview、--execution 与 --source。
 * `evidence` 是 Judge 材料（--source 不保证包含 Adapter，不进材料）；`commandResults` 是全部命令结果，供 Eval 检查取证入口可用。
 */
export async function readAttemptEvidence(sandbox: Sandbox, root: string, attempts: readonly CurrentAttempt[]) {
  const evidence: { attempt: CurrentAttempt; overview: string; execution: string }[] = [];
  const commandResults: Awaited<ReturnType<typeof runCandidateCli>>[] = [];
  for (const attempt of attempts) {
    const locator = attempt.locator;
    if (locator === undefined) throw new Error(`${attempt.evalId} 的当前结果没有发布 Attempt，无法取证`);
    const [overview, execution, source] = await Promise.all([
      runCandidateCli(sandbox, root, ["show", locator]),
      runCandidateCli(sandbox, root, ["show", locator, "--execution"]),
      runCandidateCli(sandbox, root, ["show", locator, "--source"]),
    ]);
    commandResults.push(overview, execution, source);
    evidence.push({ attempt, overview: overview.stdout, execution: execution.stdout });
  }
  return { evidence, commandResults };
}

/** 解析一段 JSON 输出；不是合法 JSON 时返回 null，由 Eval 决定这算什么。 */
export function parseJsonOrNull(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
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
