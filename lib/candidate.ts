/**
 * 候选版本。
 *
 * 被评的对象是「某个具体版本的 niceeval + 它随包发布的文档」，而不是 npm 上的 latest。
 * 所以每个 experiment 明确钉一个版本号或 dist-tag，eval 让 agent 装的就是它。
 *
 * 一个候选在宿主机上只有一个文件：`.candidate/<version>/manifest.json`，记版本号与随包
 * 文档清单，由 ensureCandidate 在实验加载时按需物化。没有 tarball——候选一律是已发布
 * 版本，npm 的同一个版本号不可重发，版本号本身就是完整的身份，manifest 只是可随时重新
 * 推导的缓存，永不过期。
 *
 * 安装前引导文档 INIT.md 不缓存到本地：它按 tag 存档在 GitHub 上（见 candidateInitDocUrl），
 * eval 让 agent 直接读那个 URL，不由 harness 转发。ensureCandidate 首次物化一个版本时
 * 仍会探一次这个 URL 有没有 200——链接失效要在实验加载这一步就响（任何沙箱启动之前），
 * 不能等到某次评估中途才被 agent 读空。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** 候选根目录，每个版本一个子目录，由 ensureCandidate 写入 */
export const CANDIDATE_ROOT = resolve(import.meta.dirname, "../.candidate");

/** niceeval 自己的仓库，候选版本按 tag 存档的地方 */
export const NICEEVAL_REPO = "CorrectRoadH/niceeval";

/** 某个版本发布时的安装前引导文档，按 tag 直接指向 GitHub raw；agent 在 send() 里直接读这个 URL。 */
export function candidateInitDocUrl(version: string): string {
  return `https://raw.githubusercontent.com/${NICEEVAL_REPO}/v${version}/INIT.md`;
}

/**
 * 把一个版本号或 dist-tag 变成可用的候选：解析成具体版本，本地没有 manifest 就现场物化
 * 一份，返回解析后的版本号。实验文件在加载时 await 它——上游随时发新 canary，这边下一次
 * 跑自动跟上，没有手工 pin 步骤。已物化过的精确版本直接命中缓存，不碰网络。
 *
 * dist-tag（canary/latest）每次都要问 registry「现在指向哪版」：tag 是移动靶，不在本地
 * 落任何指针文件；解析出的具体版本一旦物化过就复用。
 */
export async function ensureCandidate(target: string): Promise<string> {
  if (existsSync(candidatePaths(target).manifest)) return target;

  const res = await fetch("https://registry.npmjs.org/niceeval");
  if (!res.ok) throw new Error(`解析候选「${target}」失败：拉取 niceeval 包元数据 HTTP ${res.status}`);
  const packument = (await res.json()) as {
    "dist-tags": Record<string, string>;
    versions: Record<string, { dist: { tarball: string } }>;
  };
  const version = packument["dist-tags"][target] ?? target;
  const versionMeta = packument.versions[version];
  if (!versionMeta) throw new Error(`registry 上没有 niceeval@${target}`);

  const { dir, manifest } = candidatePaths(version);
  if (existsSync(manifest)) return version;

  // 随包文档清单：下载 tarball 只为列出目录，列完就丢，不进 .candidate/
  console.log(`物化候选 niceeval@${version}…`);
  const tarball = await fetch(versionMeta.dist.tarball);
  if (!tarball.ok) throw new Error(`下载 tarball 失败：HTTP ${tarball.status}`);
  const scratch = resolve(tmpdir(), `niceeval-${version}-${process.pid}.tgz`);
  writeFileSync(scratch, Buffer.from(await tarball.arrayBuffer()));
  let pages: string[];
  try {
    pages = execFileSync("tar", ["tzf", scratch], { encoding: "utf8" })
      .split("\n")
      // tarball 里每条路径都带 `package/` 前缀，剥掉后与 INDEX.md 里的树行一致
      .map((line) => line.trim().replace(/^package\//, ""))
      .filter((p) => p === "INDEX.md" || /^docs-site\/zh\/.+\.mdx$/.test(p))
      .sort();
  } finally {
    rmSync(scratch, { force: true });
  }

  // 只探活，不落盘：eval 运行时让 agent 直接读这个 URL
  const initDocUrl = candidateInitDocUrl(version);
  const initDoc = await fetch(initDocUrl, { method: "HEAD" });
  if (!initDoc.ok) {
    throw new Error(
      `探活 ${initDocUrl} 失败：HTTP ${initDoc.status}。` +
        `niceeval@${version} 对应的 GitHub tag 可能没有 INIT.md（早期版本、或 tag 名与版本号对不上），换一个更新的版本试试。`,
    );
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(manifest, JSON.stringify({ version, source: `npm:niceeval@${version}`, pages }, null, 2) + "\n");
  const hasDocs = pages.includes("INDEX.md");
  console.log(`候选就绪：niceeval@${version}（随包文档 ${hasDocs ? `${pages.length - 1} 页 + INDEX.md` : "无"}）`);
  return version;
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
      `候选还没物化：找不到 ${manifest}。实验加载时应先 await ensureCandidate("${version}")`,
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
 * （EXPECTED_PAGES 那条正则命中其一即算路由正确），而文档页会随版本改名搬家——0.9.x 的
 * how-to/ 到 0.10.x 变成了 tutorials/。题库同时列新旧两代路径，同一份题库才能
 * 横跨新旧候选对比；某几条在这个候选里不存在是预期内的（那是另一代的路径），
 * 一条都不存在才说明题库整体过期了，这时必须响。
 *
 * 候选没有随包文档时不报错：那是真 0，路由层如实读零就是正确行为。
 */
export function assertPagesInCandidate(pages: RegExp, version: string): void {
  if (!hasBundledDocs(version)) return;

  const available = readCandidateManifest(version).pages;
  if (available.some((page) => pages.test(page))) return;

  throw new Error(
    `题库的合格落点没有一条存在于候选 niceeval@${version}，路由层会静默读零：\n` +
      `  ${pages.source}\n\n` +
      `这个候选带了 ${available.length - 1} 页随包文档，说明不是「这个版本没有文档」，` +
      `而是页面全被改名/搬走了。给题库落点补上这个候选那一代的路径，再跑。`,
  );
}
