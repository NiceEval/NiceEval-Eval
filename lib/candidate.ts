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

import { execFileSync } from "node:child_process";
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
/**
 * 候选 tarball 里随包文档的真实清单（路径相对包根，与路由层的观测口径一致）。
 *
 * 存在的意义是分辨路由层读出的两种 0——它们在分数上长得一模一样：
 * 「这个版本压根没有随包文档」（0.4.1 就是，真 0，正是要测的东西）与
 * 「有文档但题库写的路径过期了」（假 0，静默失准）。
 */
const bundledDocsCache = new Map<string, CandidateBundledDocs>();

export interface CandidateBundledDocs {
  /** 这个候选到底有没有随包文档这套机制 */
  hasBundledDocs: boolean;
  /** 随包文档页与索引入口，路径相对包根 */
  pages: ReadonlySet<string>;
}

export function candidateBundledDocs(label?: string): CandidateBundledDocs {
  const key = label ?? "";
  const cached = bundledDocsCache.get(key);
  if (cached) return cached;

  const { tarball } = candidatePaths(label);
  if (!existsSync(tarball)) {
    throw new Error(`候选包还没准备好：找不到 ${tarball}。先运行 pack:candidate`);
  }
  const entries = execFileSync("tar", ["tzf", tarball], { encoding: "utf8" })
    .split("\n")
    // tarball 里每条路径都带 `package/` 前缀，剥掉后与 INDEX.md 里的树行一致
    .map((line) => line.trim().replace(/^package\//, ""))
    .filter((p) => p === "INDEX.md" || /^docs-site\/zh\/.+\.mdx$/.test(p));

  const pages = new Set(entries);
  const result = { hasBundledDocs: pages.has("INDEX.md"), pages };
  bundledDocsCache.set(key, result);
  return result;
}

/**
 * 跑之前校验合格落点在候选里真实存在，不存在就直接失败。
 *
 * 路由层是软分、按设计不 gate，所以题库路径过期不会让任何东西变红——只会让分数
 * 静默归零，看起来像「新版本的文档没起作用」。这条把那种静默变成响的。
 *
 * 候选没有随包文档时不报错：那是真 0，路由层如实读零就是正确行为。
 */
export function assertPagesInCandidate(pages: readonly string[], label?: string): void {
  const { hasBundledDocs, pages: available } = candidateBundledDocs(label);
  if (!hasBundledDocs) return;

  const missing = pages.filter((page) => !available.has(page));
  if (missing.length > 0) {
    const { version } = readCandidateManifest(label);
    throw new Error(
      `题库的合格落点在候选 niceeval@${version} 里不存在，路由层会静默读零：\n` +
        missing.map((p) => `  - ${p}`).join("\n") +
        `\n\n这个候选带了 ${available.size - 1} 页随包文档，说明不是「这个版本没有文档」，` +
        `而是页面被改名/搬走了。更新题库与 lib/debug-eval.ts 的合格落点，再跑。`,
    );
  }
}

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
