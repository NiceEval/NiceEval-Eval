/**
 * 候选包注入。
 *
 * 被评的对象是「某个具体版本的 niceeval 包 + 它随包发布的文档」，而不是 npm 上的 latest。
 * 所以每次运行都把一个确定的 tarball 注入进 sandbox，agent 从本地文件安装——
 * 这样评估结果能钉到版本，也能评还没发布的构建。
 *
 * tarball 由 `pnpm run pack:candidate` 预先准备到 .candidate/ 下（见 scripts/pack-candidate.ts）。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SandboxHook } from "niceeval/sandbox";

/** 候选包在宿主机上的位置，由 pack:candidate 写入 */
export const CANDIDATE_DIR = resolve(import.meta.dirname, "../.candidate");
export const CANDIDATE_TARBALL = resolve(CANDIDATE_DIR, "niceeval.tgz");
export const CANDIDATE_MANIFEST = resolve(CANDIDATE_DIR, "manifest.json");

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

export function readCandidateManifest(): CandidateManifest {
  if (!existsSync(CANDIDATE_MANIFEST)) {
    throw new Error(
      `候选包还没准备好：找不到 ${CANDIDATE_MANIFEST}。先运行 pnpm run pack:candidate`,
    );
  }
  return JSON.parse(readFileSync(CANDIDATE_MANIFEST, "utf8")) as CandidateManifest;
}

/**
 * 环境钩子：把候选 tarball（以及可选的安装前引导文档 INIT.md）放进 sandbox。
 *
 * 挂在 experiment 的 sandbox spec 上而不是写在 eval 里，是因为这属于「这次实验的环境」：
 * setup 钩子写下的文件进 git 基线，不会被算成 agent 改的文件，所以 diff 断言不会被污染。
 *
 * @param opts.withInitDoc 是否投放 INIT.md。这是两个对照组的唯一环境差异：
 *   投放 = agent 有安装前引导文档链；不投放 = agent 只能凭训练记忆装。
 */
export function injectCandidate(opts: { withInitDoc: boolean }): SandboxHook {
  return async (sandbox, ctx) => {
    const manifest = readCandidateManifest();
    ctx.progress({ message: `注入候选包 niceeval@${manifest.version}` });

    const tarball = readFileSync(CANDIDATE_TARBALL);
    await sandbox.uploadFiles([{ path: SANDBOX_CANDIDATE_PATH, content: tarball }]);

    if (opts.withInitDoc) {
      const initDoc = resolve(CANDIDATE_DIR, "INIT.md");
      if (!existsSync(initDoc)) {
        throw new Error(`要求投放 INIT.md，但 ${initDoc} 不存在。重新运行 pnpm run pack:candidate`);
      }
      await sandbox.uploadFiles([
        { path: SANDBOX_INIT_DOC_PATH, content: readFileSync(initDoc) },
      ]);
    }

    // fail-fast：候选包不可读的话，后面 agent 的每一步失败都会被误判成「agent 不会装」
    const check = await sandbox.runCommand("test", ["-s", SANDBOX_CANDIDATE_PATH]);
    if (check.exitCode !== 0) {
      throw new Error(`候选包上传后不可读：${SANDBOX_CANDIDATE_PATH}`);
    }
  };
}
