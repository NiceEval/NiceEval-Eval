/**
 * 候选版本。
 *
 * 被评的对象是「某个具体版本的 niceeval + 它随包发布的文档」，而不是 npm 上的 latest。
 * 所以每个 experiment 明确钉一个版本号，eval 让 agent 装的就是它。
 *
 * 一个候选在宿主机上只有一个文件（`pnpm exec tsx scripts/pin-candidate.ts <version>` 写入）：
 * `manifest.json`，记版本号与随包文档清单。没有 tarball——候选一律是已发布版本，版本号
 * 本身就是完整的身份。
 *
 * 安装前引导文档 INIT.md 不缓存到本地：它按 tag 存档在 GitHub 上（见 candidateInitDocUrl），
 * eval 让 agent 直接读那个 URL，不由 harness 转发。`pin-candidate.ts` 仍会在钉版本时探一次
 * 这个 URL 有没有 200——链接失效要在钉版本这一步就响，不能等到某次评估中途才被 agent 读空。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 候选根目录，每个版本一个子目录，由 pin-candidate.ts 写入 */
export const CANDIDATE_ROOT = resolve(import.meta.dirname, "../.candidate");

/** niceeval 自己的仓库，候选版本按 tag 存档的地方 */
export const NICEEVAL_REPO = "CorrectRoadH/niceeval";

/** 某个版本发布时的安装前引导文档，按 tag 直接指向 GitHub raw；agent 在 send() 里直接读这个 URL。 */
export function candidateInitDocUrl(version: string): string {
  return `https://raw.githubusercontent.com/${NICEEVAL_REPO}/v${version}/INIT.md`;
}

export interface CandidateManifest {
  /** 被评的 niceeval 版本 */
  version: string;
  /** 来源，进结果元数据 */
  source: string;
  /** 这个版本随包发的文档页与索引入口，路径相对包根 */
  pages: string[];
}

/** 某个候选版本在宿主机上的落点 */
export function candidatePaths(version: string): { dir: string; manifest: string } {
  const dir = resolve(CANDIDATE_ROOT, version);
  return { dir, manifest: resolve(dir, "manifest.json") };
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
 * 跑之前校验合格落点在候选里真实存在，全部落空才失败。
 *
 * 路由层是软分、按设计不 gate，所以题库路径过期不会让任何东西变红——只会让分数
 * 静默归零，看起来像「新版本的文档没起作用」。这条把那种静默变成响的。
 *
 * 判「至少一条存在」而不是「全部存在」：expected 本来就是一组等价的合格落点
 * （routedTo 任意一页命中即算路由正确），而文档页会随版本改名搬家——0.9.x 的
 * how-to/ 到 0.10.x 变成了 tutorials/。题库同时列新旧两代路径，同一份题库才能
 * 横跨新旧候选对比；某几条在这个候选里不存在是预期内的（那是另一代的路径），
 * 一条都不存在才说明题库整体过期了，这时必须响。
 *
 * 候选没有随包文档时不报错：那是真 0，路由层如实读零就是正确行为。
 */
export function assertPagesInCandidate(pages: readonly string[], version: string): void {
  if (!hasBundledDocs(version)) return;

  const available = new Set(readCandidateManifest(version).pages);
  if (pages.some((page) => available.has(page))) return;

  throw new Error(
    `题库的合格落点没有一条存在于候选 niceeval@${version}，路由层会静默读零：\n` +
      pages.map((p) => `  - ${p}`).join("\n") +
      `\n\n这个候选带了 ${available.size - 1} 页随包文档，说明不是「这个版本没有文档」，` +
      `而是页面全被改名/搬走了。给题库落点补上这个候选那一代的路径，再跑。`,
  );
}
