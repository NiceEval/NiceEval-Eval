/**
 * 钉一个候选版本：把「这次要评的那个 niceeval 发布」固化到 .candidate/<version>/ 下。
 *
 *   pnpm exec tsx scripts/pin-candidate.ts            # 当前 latest
 *   pnpm exec tsx scripts/pin-candidate.ts 0.9.1      # 指定版本
 *
 * 固化下来的只有两样东西：版本号与那个版本发布时的 INIT.md。
 *
 * 不存 tarball。候选一律是已发布版本，`pnpm add niceeval@<version>` 就能精确复现——
 * npm 的同一个版本号不可重发，版本号本身就是完整的身份，tarball 与 sha256 都不再提供
 * 任何额外信息。
 *
 * INIT.md 必须单独固化：它不在包的 files 白名单里，装了包也拿不到。而且要按版本取——
 * niceeval.com/INIT.md 只有「现在」这一份，按版本存档的是 GitHub 仓库的 tag。评
 * 「0.4.1 的文案改版有没有效果」时，读到的就得是 0.4.1 发布时那份，不是今天的。
 *
 * manifest 里还记下这个版本随包发了哪些文档页，给 assertPagesInCandidate 用来分辨
 * 「这个版本没有随包文档」与「题库路径过期了」——两者在路由层都读作 0（见 lib/candidate.ts）。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const CANDIDATE_ROOT = resolve(import.meta.dirname, "../.candidate");
const NICEEVAL_REPO = "CorrectRoadH/niceeval";

// pnpm 11 不会吃掉 `--`，它原样进 argv。显式滤掉，脚本行为不随 pnpm 版本变化。
const args = process.argv.slice(2).filter((a) => a !== "--");
const target = args[0] ?? "latest";

// 直接走 registry 的 HTTP API，不调 npm CLI：本仓库 package.json 声明了 devEngines: pnpm，
// npm 会向上找到它、判定引擎不匹配后直接退出。
console.log(`解析 niceeval@${target}…`);
const meta = await fetch("https://registry.npmjs.org/niceeval");
if (!meta.ok) throw new Error(`拉取包元数据失败：HTTP ${meta.status}`);
const packument = (await meta.json()) as {
  "dist-tags": Record<string, string>;
  versions: Record<string, { dist: { tarball: string } }>;
};

const version = packument["dist-tags"][target] ?? target;
const versionMeta = packument.versions[version];
if (!versionMeta) throw new Error(`registry 上没有 niceeval@${target}`);

// 目录按解析后的版本号命名，不再有「label 与版本号两处填、还得自己保持一致」那个坑
const dir = resolve(CANDIDATE_ROOT, version);
mkdirSync(dir, { recursive: true });
for (const entry of readdirSync(dir)) rmSync(resolve(dir, entry), { recursive: true, force: true });

// 随包文档清单：下载 tarball 只为列出目录，列完就丢，不进 .candidate/
console.log(`盘点随包文档…`);
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

// 按 tag 取这个版本发布时的 INIT.md，不是网站现在那份
const initDocUrl = `https://raw.githubusercontent.com/${NICEEVAL_REPO}/v${version}/INIT.md`;
console.log(`按版本抓取安装前引导文档：${initDocUrl}`);
const initDoc = await fetch(initDocUrl);
if (!initDoc.ok) {
  throw new Error(
    `拉取 ${initDocUrl} 失败：HTTP ${initDoc.status}。` +
      `niceeval@${version} 对应的 GitHub tag 可能没有 INIT.md（早期版本、或 tag 名与版本号对不上），换一个更新的版本试试。`,
  );
}
writeFileSync(resolve(dir, "INIT.md"), await initDoc.text());

writeFileSync(
  resolve(dir, "manifest.json"),
  JSON.stringify({ version, source: `npm:niceeval@${version}`, pages }, null, 2) + "\n",
);

const hasBundledDocs = pages.includes("INDEX.md");
console.log(`\n候选就绪：niceeval@${version}`);
console.log(`  随包文档: ${hasBundledDocs ? `${pages.length - 1} 页 + INDEX.md` : "无（这个版本还没有这套机制）"}`);
console.log(`  落点:     ${dir}`);
