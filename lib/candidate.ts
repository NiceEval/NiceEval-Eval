/**
 * 候选版本。
 *
 * 被评的对象是「某个具体版本的 niceeval + 它随包发布的文档」，而不是 npm 上的 latest。
 * 所以每个 experiment 明确指定版本号或解析规则，eval 让 agent 装解析出的精确版本。
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

/**
 * 带退避重试的 fetch。
 *
 * 物化候选发生在**实验加载**这一步，比任何 sandbox 都早：这里抛错的代价是整条命令直接
 * 死掉（连没被选中的实验也一起，因为发现阶段会 import 全部实验文件）。而这几个请求打的是
 * 公网 registry 与 GitHub raw，瞬时的 ECONNRESET / TLS 握手失败是常态，不代表候选有问题。
 * 所以传输层错误一律重试；HTTP 状态码交给调用方判断（404 这类要立刻响，重试没有意义）。
 */
async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
      console.error(`请求 ${url} 失败（${cause?.message ?? String(error)}），${attempt}/${attempts}，重试中…`);
      await new Promise((done) => setTimeout(done, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`请求 ${url} 连续 ${attempts} 次失败（网络问题，不是候选本身的问题）`, { cause: lastError });
}

/** 候选根目录，每个版本一个子目录，由 ensureCandidate 写入 */
const CANDIDATE_ROOT = resolve(import.meta.dirname, "../.candidate");

/** niceeval 自己的仓库，候选版本按 tag 存档的地方 */
const NICEEVAL_REPO = "CorrectRoadH/niceeval";

/** 某个版本发布时的安装前引导文档，按 tag 直接指向 GitHub raw；agent 在 send() 里直接读这个 URL。 */
export function candidateInitDocUrl(version: string): string {
  return `https://raw.githubusercontent.com/${NICEEVAL_REPO}/v${version}/INIT.md`;
}

function parseVersion(version: string): { core: string[]; prerelease: string[] } {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  const prerelease = match?.[4]?.split(".") ?? [];
  if (!match || prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    throw new Error(`无效的 semver 版本号：${version}`);
  }
  return { core: match.slice(1, 4), prerelease };
}

/** 按 semver 比较已发布版本；build metadata 不影响优先级。 */
export function compareCandidateVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    const x = BigInt(a.core[i]!);
    const y = BigInt(b.core[i]!);
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 把一个版本号或 dist-tag 变成可用的候选：解析成具体版本，本地没有 manifest 就现场物化
 * 一份，返回解析后的版本号。实验文件在加载时 await 它——上游随时发新 canary，这边下一次
 * 跑自动跟上，没有手工 pin 步骤。已物化过的精确版本直接命中缓存，不碰网络。
 *
 * canary 每次从 registry 的全部已发布版本按 semver 取最大值（含预发布版），不依赖
 * canary dist-tag。其它 dist-tag 仍按 registry 指向解析；不落本地指针文件，解析出的
 * 具体版本一旦物化过就复用。
 */
export async function ensureCandidate(target: string): Promise<string> {
  if (target !== "canary" && existsSync(candidatePaths(target).manifest)) return target;

  const res = await fetchWithRetry("https://registry.npmjs.org/niceeval");
  if (!res.ok) throw new Error(`解析候选「${target}」失败：拉取 niceeval 包元数据 HTTP ${res.status}`);
  const packument = (await res.json()) as {
    "dist-tags": Record<string, string>;
    versions: Record<string, { dist: { tarball: string } }>;
  };
  const version = target === "canary"
    ? Object.keys(packument.versions).reduce((newest, current) =>
        compareCandidateVersions(current, newest) > 0 ? current : newest,
      )
    : packument["dist-tags"][target] ?? target;
  const versionMeta = packument.versions[version];
  if (!versionMeta) throw new Error(`registry 上没有 niceeval@${target}`);

  const { dir, manifest } = candidatePaths(version);
  if (existsSync(manifest)) return version;

  // 随包文档清单：下载 tarball 只为列出目录，列完就丢，不进 .candidate/
  // 诊断信息走 stderr，避免污染 `niceeval ... --json` 的结构化 stdout。
  console.error(`物化候选 niceeval@${version}…`);
  const tarball = await fetchWithRetry(versionMeta.dist.tarball);
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
  const initDoc = await fetchWithRetry(initDocUrl, { method: "HEAD" });
  if (!initDoc.ok) {
    throw new Error(
      `探活 ${initDocUrl} 失败：HTTP ${initDoc.status}。` +
        `niceeval@${version} 对应的 GitHub tag 可能没有 INIT.md，或 tag 名与版本号对不上。`,
    );
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(manifest, JSON.stringify({ version, source: `npm:niceeval@${version}`, pages }, null, 2) + "\n");
  console.error(`候选就绪：niceeval@${version}（随包文档 ${pages.length} 项）`);
  return version;
}

interface CandidateManifest {
  /** 被评的 niceeval 版本 */
  version: string;
  /** 来源，进结果元数据 */
  source: string;
  /** 这个版本随包发的文档页与索引入口，路径相对包根 */
  pages: string[];
}

/** 某个候选版本在宿主机上的落点 */
function candidatePaths(version: string): { dir: string; manifest: string } {
  const dir = resolve(CANDIDATE_ROOT, version);
  return { dir, manifest: resolve(dir, "manifest.json") };
}

const manifestCache = new Map<string, CandidateManifest>();

function readCandidateManifest(version: string): CandidateManifest {
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

/**
 * 跑之前校验路由落点在候选里真实存在，一条都不在才失败。
 *
 * 路由项是软分，页面改名搬家时不会变红，只会静默读零，看起来像「新版本文档没起作用」。
 * pages 是一组等价落点，命中其一即可。
 */
export function assertPagesInCandidate(pages: RegExp, version: string): void {
  const available = readCandidateManifest(version).pages;
  if (available.some((page) => pages.test(page))) return;

  throw new Error(
    `题库的合格落点没有一条存在于候选 niceeval@${version}，路由项会静默读零：\n` +
      `  ${pages.source}\n` +
      `给题库落点补上这个候选的页面路径，再跑。`,
  );
}
