/**
 * 候选版本。
 *
 * 被评的对象是「某个具体版本的 niceeval + 它随包发布的文档」，而不是 npm 上的 latest。
 * 所以每个 experiment 明确钉一个版本号，eval 让 agent 装的就是它。
 *
 * 一个候选在宿主机上只有两个文件（`pnpm exec tsx scripts/pin-candidate.ts <version>` 写入）：
 * `manifest.json` 记版本号与随包文档清单，`INIT.md` 是那个版本发布时的安装前引导文档。
 * 没有 tarball——候选一律是已发布版本，版本号本身就是完整的身份。
 *
 * INIT.md 得单独固化：它不在包的 files 白名单里，装了包也拿不到。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SandboxHook } from "niceeval/sandbox";

/** 候选根目录，每个版本一个子目录，由 pin-candidate.ts 写入 */
export const CANDIDATE_ROOT = resolve(import.meta.dirname, "../.candidate");

/** sandbox 内安装前引导文档的落点。放在 workdir 之外，避免混进 agent 的 diff。 */
export const SANDBOX_INIT_DOC_PATH = "/opt/niceeval-candidate/INIT.md";

export interface CandidateManifest {
  /** 被评的 niceeval 版本 */
  version: string;
  /** 来源，进结果元数据 */
  source: string;
  /** 这个版本随包发的文档页与索引入口，路径相对包根 */
  pages: string[];
}

/** 某个候选版本在宿主机上的两个文件 */
export function candidatePaths(version: string): { dir: string; manifest: string; initDoc: string } {
  const dir = resolve(CANDIDATE_ROOT, version);
  return { dir, manifest: resolve(dir, "manifest.json"), initDoc: resolve(dir, "INIT.md") };
}

const manifestCache = new Map<string, CandidateManifest>();

export function readCandidateManifest(version: string): CandidateManifest {
  const cached = manifestCache.get(version);
  if (cached) return cached;

  const { manifest } = candidatePaths(version);
  if (!existsSync(manifest)) {
    throw new Error(
      `候选还没钉好：找不到 ${manifest}。先运行 pnpm exec tsx scripts/pin-candidate.ts ${version}`,
    );
  }
  const parsed = JSON.parse(readFileSync(manifest, "utf8")) as CandidateManifest;
  manifestCache.set(version, parsed);
  return parsed;
}

/** 这个版本有没有随包文档这套机制（0.4.x 就没有） */
export function hasBundledDocs(version: string): boolean {
  return readCandidateManifest(version).pages.includes("INDEX.md");
}

/**
 * 跑之前校验合格落点在候选里真实存在，不存在就直接失败。
 *
 * 路由层是软分、按设计不 gate，所以题库路径过期不会让任何东西变红——只会让分数
 * 静默归零，看起来像「新版本的文档没起作用」。这条把那种静默变成响的。
 *
 * 候选没有随包文档时不报错：那是真 0，路由层如实读零就是正确行为。
 */
export function assertPagesInCandidate(pages: readonly string[], version: string): void {
  if (!hasBundledDocs(version)) return;

  const available = new Set(readCandidateManifest(version).pages);
  const missing = pages.filter((page) => !available.has(page));
  if (missing.length > 0) {
    throw new Error(
      `题库的合格落点在候选 niceeval@${version} 里不存在，路由层会静默读零：\n` +
        missing.map((p) => `  - ${p}`).join("\n") +
        `\n\n这个候选带了 ${available.size - 1} 页随包文档，说明不是「这个版本没有文档」，` +
        `而是页面被改名/搬走了。更新题库与各 eval 的合格落点，再跑。`,
    );
  }
}

/**
 * 环境钩子：把安装前引导文档 INIT.md 放进 sandbox。
 *
 * 挂在 experiment 的 sandbox spec 上而不是写在 eval 里，是因为这属于「这次实验的环境」：
 * setup 钩子写下的文件进 git 基线，不会被算成 agent 改的文件，所以 diff 断言不会被污染。
 */
export function injectCandidate(version: string): SandboxHook {
  return async (sandbox, ctx) => {
    const manifest = readCandidateManifest(version);
    ctx.progress({ message: `投放 niceeval@${manifest.version} 的引导文档` });

    const { initDoc } = candidatePaths(version);
    await sandbox.uploadFiles([{ path: SANDBOX_INIT_DOC_PATH, content: readFileSync(initDoc) }]);

    // fail-fast：引导文档不可读的话，后面 agent 的每一步失败都会被误判成「agent 不会装」
    const check = await sandbox.runCommand("test", ["-s", SANDBOX_INIT_DOC_PATH]);
    if (check.exitCode !== 0) {
      throw new Error(`引导文档上传后不可读：${SANDBOX_INIT_DOC_PATH}`);
    }
  };
}
