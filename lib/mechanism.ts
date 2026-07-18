/**
 * 机制层断言：安装链到底通没通。
 *
 * 这一层全部是客观事实，不含任何品味判断——文件在不在、版本对不对、命令退不退 0。
 * 它是三层里唯一应该 gate 的一层：机制层红了，说明 agent 没把 niceeval 装成一个
 * 能用的东西，后面「写得好不好」「读没读对文档」都失去了讨论前提。
 */

import { readCandidateManifest } from "./candidate.ts";

/** t.sandbox 用到的最小方法集（避免把内部类型钉死在这里） */
export interface SandboxLike {
  runShell(script: string, opts?: { cwd?: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
}

export interface InstallLayout {
  /** 相对 workdir 的安装根目录（含 niceeval.config.ts 的那一层） */
  root: string;
  /** 是否真的找到了安装位置 */
  found: boolean;
}

/**
 * 找 agent 把 niceeval 装在了哪。
 *
 * 不假设一定在 workdir 根：python-service 这类非 JS 宿主的正确做法就是
 * 就地新建一个子目录来放 package.json 与三件套，装在子目录里不算错。
 */
export async function locateInstall(sandbox: SandboxLike): Promise<InstallLayout> {
  const found = await sandbox.runShell(
    `find . -name niceeval.config.ts -not -path '*/node_modules/*' -maxdepth 3 | head -1`,
  );
  const hit = found.stdout.trim();
  if (!hit) return { root: ".", found: false };
  // ./sub/niceeval.config.ts -> sub ; ./niceeval.config.ts -> .
  const dir = hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "");
  return { root: dir === "" ? "." : dir, found: true };
}

export interface MechanismFacts {
  layout: InstallLayout;
  /** node_modules/niceeval 解析到的版本 */
  installedVersion: string | null;
  /** 解析到的版本是否就是我们注入的候选包 */
  resolvesToCandidate: boolean;
  /** init 写进 AGENTS.md / CLAUDE.md 的托管指引区块存在 */
  hasManagedBlock: boolean;
  /** agent 写出的 eval 文件数 */
  evalFileCount: number;
  /** agent 写出的 experiment 文件数 */
  experimentFileCount: number;
  /** 是否按 compare-models 实验组组织 */
  hasCompareGroup: boolean;
  /** niceeval 能否发现 agent 写出的 eval */
  listExitCode: number;
  listOutput: string;
  discoveredEvalCount: number;
  /**
   * agent 自己写的代码里的 typecheck 错误数；没有 tsconfig 时为 null
   * （不算失败，非 TS 宿主可以没有）。
   *
   * 只数 node_modules 之外的错误：niceeval 把 TS 源码一起发布，而 e2b /
   * @vercel/sandbox 是按需安装的可选 peer 依赖，只装 docker 时 tsc 会在包自己的
   * 源码里报一堆「找不到模块」。把那些算进来，等于让每个 attempt 都栽在与 agent
   * 无关的错误上——gate 会全红，而且红得毫无信息量。
   */
  typecheckErrorCount: number | null;
  /**
   * agent 是否真的跑出过结果（.niceeval 里有落盘 artifact）。
   *
   * 只作软分：跑通一次实验需要被测应用在沙箱里起得来，这依赖 agent 自己决定
   * 起不起后台进程，波动大；把它 gate 会让「装对了但没顺手跑一次」被判成安装失败。
   */
  producedResults: boolean;
}

/** 数 tsc 输出里属于 agent 自己代码的错误行（`path(line,col): error TSxxxx:`） */
export function countOwnTypeErrors(tscOutput: string): number {
  return tscOutput
    .split("\n")
    .filter((line) => /^\S+\(\d+,\d+\): error TS\d+:/.test(line))
    .filter((line) => !line.includes("node_modules")).length;
}

/** 在 sandbox 里把机制层的全部客观事实收一遍，收完再断言，便于一次运行看清全貌 */
export async function collectMechanismFacts(sandbox: SandboxLike): Promise<MechanismFacts> {
  const layout = await locateInstall(sandbox);
  const at = layout.root;

  const versionProbe = await sandbox.runShell(
    `node -p "require('./node_modules/niceeval/package.json').version" 2>/dev/null || true`,
    { cwd: at },
  );
  const installedVersion = versionProbe.stdout.trim() || null;
  const candidate = readCandidateManifest();

  const managed = await sandbox.runShell(
    `grep -l "node_modules/niceeval" AGENTS.md CLAUDE.md 2>/dev/null | head -1`,
    { cwd: at },
  );

  const evalFiles = await sandbox.runShell(
    `find . -name '*.eval.ts' -not -path '*/node_modules/*' | wc -l`,
    { cwd: at },
  );
  const experimentFiles = await sandbox.runShell(
    `find experiments -name '*.ts' 2>/dev/null | wc -l`,
    { cwd: at },
  );
  const compareGroup = await sandbox.runShell(
    `ls -d experiments/compare-models 2>/dev/null | head -1`,
    { cwd: at },
  );

  // 用 agent 自己装的那个 CLI 来发现 eval——这一步同时验证了「装的东西是能跑的」
  const list = await sandbox.runShell(`npx --no-install niceeval list 2>&1`, { cwd: at });

  const results = await sandbox.runShell(
    `find .niceeval -name 'result.json' 2>/dev/null | head -1`,
    { cwd: at },
  );

  const hasTsconfig = await sandbox.fileExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const typecheck = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

  return {
    layout,
    installedVersion,
    resolvesToCandidate: installedVersion === candidate.version,
    hasManagedBlock: managed.stdout.trim().length > 0,
    evalFileCount: Number(evalFiles.stdout.trim()) || 0,
    experimentFileCount: Number(experimentFiles.stdout.trim()) || 0,
    hasCompareGroup: compareGroup.stdout.trim().length > 0,
    listExitCode: list.exitCode,
    listOutput: list.stdout,
    // list 的输出里每条 eval 一行；只数含 eval id 分隔符的行，避免把表头算进来
    discoveredEvalCount: list.stdout
      .split("\n")
      .filter((line) => /\S/.test(line) && !/^(NAME|ID|—|-{3,})/.test(line.trim())).length,
    typecheckErrorCount: typecheck ? countOwnTypeErrors(typecheck.stdout) : null,
    producedResults: results.stdout.trim().length > 0,
  };
}
