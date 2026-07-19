/**
 * 候选包注入。
 *
 * 被评的对象是「某个具体版本的 niceeval 包 + 它随包发布的文档」，而不是 npm 上的 latest。
 * 所以每次运行都把一个确定的 tarball 注入进 sandbox，agent 从本地文件安装——
 * 这样评估结果能钉到版本，也能评还没发布的构建。
 *
 * 默认候选（`pnpm run pack:candidate`）固化到 .candidate/ 下（见 scripts/pack-candidate.ts），
 * 供两个对照组（有/无安装前引导文档）共用。要横向对比不同 niceeval 版本时，
 * 额外用 `pnpm run pack:candidate -- <target> <label>` 把候选打到 .candidate/versions/<label>/，
 * 每个 label 是一次独立的、可钉版本的候选，experiment 用 `candidateVersion` flag 选用哪个。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SandboxHook } from "niceeval/sandbox";

/** 默认候选包在宿主机上的位置，由 pack:candidate 写入 */
export const CANDIDATE_DIR = resolve(import.meta.dirname, "../.candidate");
/** 具名候选（用于版本对比）的根目录，每个 label 一个子目录，结构与默认候选一致 */
export const CANDIDATE_VERSIONS_DIR = resolve(CANDIDATE_DIR, "versions");

/** sandbox 内候选包与安装前引导文档的落点。放在 workdir 之外，避免混进 agent 的 diff。 */
export const SANDBOX_CANDIDATE_PATH = "/opt/niceeval-candidate/niceeval.tgz";
export const SANDBOX_INIT_DOC_PATH = "/opt/niceeval-candidate/INIT.md";

export interface CandidateManifest {
  /** 被评的 niceeval 版本 */
  version: string;
  /** tarball 内容的 sha256，进结果元数据，用来区分「同版本号但不同构建」 */
  sha256: string;
  /** tarball 来源：npm registry 或本地 pnpm pack */
  source: string;
}

/** 某个候选（默认候选，或 versions/ 下某个具名 label）在宿主机上的三个文件路径 */
export function candidatePaths(label?: string): { dir: string; tarball: string; manifest: string; initDoc: string } {
  const dir = label ? resolve(CANDIDATE_VERSIONS_DIR, label) : CANDIDATE_DIR;
  return {
    dir,
    tarball: resolve(dir, "niceeval.tgz"),
    manifest: resolve(dir, "manifest.json"),
    initDoc: resolve(dir, "INIT.md"),
  };
}

export function readCandidateManifest(label?: string): CandidateManifest {
  const { manifest } = candidatePaths(label);
  if (!existsSync(manifest)) {
    const hint = label
      ? `pnpm run pack:candidate -- <target> ${label}`
      : `pnpm run pack:candidate`;
    throw new Error(`候选包还没准备好：找不到 ${manifest}。先运行 ${hint}`);
  }
  return JSON.parse(readFileSync(manifest, "utf8")) as CandidateManifest;
}

/**
 * 环境钩子：把候选 tarball 与安装前引导文档 INIT.md 放进 sandbox。
 *
 * 挂在 experiment 的 sandbox spec 上而不是写在 eval 里，是因为这属于「这次实验的环境」：
 * setup 钩子写下的文件进 git 基线，不会被算成 agent 改的文件，所以 diff 断言不会被污染。
 *
 * @param opts.candidateLabel 省略 = 用默认候选（.candidate/）；传值 = 用
 *   .candidate/versions/<label>/ 下那次单独 pack 的候选，用于版本对比 experiment。
 */
export function injectCandidate(opts: { candidateLabel?: string }): SandboxHook {
  return async (sandbox, ctx) => {
    const { tarball: tarballPath, initDoc: initDocPath } = candidatePaths(opts.candidateLabel);
    const manifest = readCandidateManifest(opts.candidateLabel);
    ctx.progress({ message: `注入候选包 niceeval@${manifest.version}` });

    const tarball = readFileSync(tarballPath);
    await sandbox.uploadFiles([{ path: SANDBOX_CANDIDATE_PATH, content: tarball }]);

    if (!existsSync(initDocPath)) {
      throw new Error(`找不到 ${initDocPath}。重新运行 pack:candidate`);
    }
    await sandbox.uploadFiles([{ path: SANDBOX_INIT_DOC_PATH, content: readFileSync(initDocPath) }]);

    // fail-fast：候选包不可读的话，后面 agent 的每一步失败都会被误判成「agent 不会装」
    const check = await sandbox.runCommand("test", ["-s", SANDBOX_CANDIDATE_PATH]);
    if (check.exitCode !== 0) {
      throw new Error(`候选包上传后不可读：${SANDBOX_CANDIDATE_PATH}`);
    }
  };
}
