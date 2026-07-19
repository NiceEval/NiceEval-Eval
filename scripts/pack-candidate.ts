/**
 * 准备候选包：把「这次要评的那个 niceeval 构建」固化到 .candidate/ 下。
 *
 * 两种来源：
 *   pnpm run pack:candidate                    # 从 npm 取当前 latest
 *   pnpm run pack:candidate -- 0.9.1           # 从 npm 取指定版本
 *   pnpm run pack:candidate -- ../niceeval     # 从本地仓库现打一个（评还没发布的构建）
 *
 * 加第二个参数 = 打一个具名候选，供版本对比 experiment 用（见 experiments/install/v0.4.ts、v0.9.ts），
 * 不影响默认候选（baseline experiment 用的仍是不带 label 的那份）：
 *   pnpm run pack:candidate -- 0.9.1 v0.9      # 固化到 .candidate/versions/v0.9/
 *   pnpm run pack:candidate -- 0.4.1 v0.4      # 固化到 .candidate/versions/v0.4/
 *
 * 同时把安装前引导文档 INIT.md 固化下来，钉在跟 tarball 同一个版本上——不是每次都抓
 * niceeval.com 当前的最新文案。niceeval.com/INIT.md 只有「现在」这一份，没有历史版本；
 * 真正按版本存档的是 GitHub 仓库的 tag，所以这里从 `CorrectRoadH/niceeval` 对应 tag
 * 的 INIT.md 现读现存。这样候选包和它的安装引导文档才是同一个版本切出来的东西：
 * 评「0.4.1 的文案改版有没有效果」时，读到的就是 0.4.1 发布时那份 INIT.md，不是今天的。
 * 从本地仓库打包（`../niceeval`）时更简单：直接读本地工作区的 INIT.md，连 GitHub 都不用查。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATE_ROOT = resolve(import.meta.dirname, "../.candidate");
const NICEEVAL_REPO = "CorrectRoadH/niceeval";

// 这个安装的 pnpm 版本不会替我们吃掉 `pnpm run pack:candidate -- 0.9.1` 里那个 `--`——
// 它原样出现在 argv 里，而不是像老版本 npm/pnpm 那样被当成分隔符吃掉。
// 显式过滤掉，脚本行为不随 pnpm 版本变化而变化。
const args = process.argv.slice(2).filter((a) => a !== "--");
const target = args[0] ?? "latest";
const label = args[1];
const isLocalRepo = target.startsWith(".") || target.startsWith("/");

// 不带 label：默认候选就是 .candidate/ 自己。
// 带 label：打到 .candidate/versions/<label>/ 这一个子目录。
const CANDIDATE_DIR = label ? resolve(CANDIDATE_ROOT, "versions", label) : CANDIDATE_ROOT;

// 只清掉 CANDIDATE_DIR 自己直接持有的文件，不整个递归删除目录本身：
// 默认候选的 CANDIDATE_DIR 就是 .candidate/ 根，而 versions/ 也挂在这个根下面——
// 递归删除整个目录会把所有具名候选（版本对比用的）一并清空，重打默认候选变成
// 意外抹掉所有已经打好的对比候选。
mkdirSync(CANDIDATE_DIR, { recursive: true });
for (const entry of readdirSync(CANDIDATE_DIR)) {
  if (entry === "versions") continue; // 具名候选的根，不是这份候选自己的文件
  rmSync(resolve(CANDIDATE_DIR, entry), { recursive: true, force: true });
}

let source: string;
let resolvedVersion: string;
/** INIT.md 正文；两个分支各自现取，取到后统一落盘 */
let initDocText: string;

if (isLocalRepo) {
  const repo = resolve(process.cwd(), target);
  if (!existsSync(resolve(repo, "package.json"))) {
    throw new Error(`${repo} 不像一个 npm 包（没有 package.json）`);
  }
  console.log(`从本地仓库打包：${repo}`);
  // pnpm pack 会跑 prepare —— INDEX.md 正是在这一步生成的，所以本地打出来的包
  // 和发版产物走的是同一条链路，不会出现「本地没有随包索引」这种假失败
  execFileSync("pnpm", ["pack", "--pack-destination", CANDIDATE_DIR], {
    cwd: repo,
    stdio: "inherit",
  });
  source = `local:${repo}`;
  const packed = readdirSync(CANDIDATE_DIR).find((f) => f.endsWith(".tgz"));
  if (!packed) throw new Error("打包后没找到 .tgz");
  renameSync(resolve(CANDIDATE_DIR, packed), resolve(CANDIDATE_DIR, "niceeval.tgz"));
  resolvedVersion = packed.replace(/^niceeval-/, "").replace(/\.tgz$/, "");

  const localInitDoc = resolve(repo, "INIT.md");
  if (!existsSync(localInitDoc)) {
    throw new Error(`本地仓库没有 INIT.md：${localInitDoc}`);
  }
  initDocText = readFileSync(localInitDoc, "utf8");
} else {
  // 直接走 registry 的 HTTP API，不调 npm CLI：本仓库的 package.json 声明了
  // devEngines: pnpm，npm 会向上找到它、判定引擎不匹配后直接退出，pack 根本跑不起来。
  console.log(`从 npm registry 下载：niceeval@${target}`);
  const meta = await fetch(`https://registry.npmjs.org/niceeval`);
  if (!meta.ok) throw new Error(`拉取包元数据失败：HTTP ${meta.status}`);
  const packument = (await meta.json()) as {
    "dist-tags": Record<string, string>;
    versions: Record<string, { dist: { tarball: string } }>;
  };

  resolvedVersion = packument["dist-tags"][target] ?? target;
  const versionMeta = packument.versions[resolvedVersion];
  if (!versionMeta) {
    throw new Error(`registry 上没有 niceeval@${target}`);
  }

  const tarball = await fetch(versionMeta.dist.tarball);
  if (!tarball.ok) throw new Error(`下载 tarball 失败：HTTP ${tarball.status}`);
  writeFileSync(
    resolve(CANDIDATE_DIR, "niceeval.tgz"),
    Buffer.from(await tarball.arrayBuffer()),
  );
  source = `npm:niceeval@${resolvedVersion}`;

  // 按 tag 取这个版本发布时的 INIT.md，不是网站现在的版本——两者可能不是同一份文案。
  const initDocUrl = `https://raw.githubusercontent.com/${NICEEVAL_REPO}/v${resolvedVersion}/INIT.md`;
  console.log(`按版本抓取安装前引导文档：${initDocUrl}`);
  const initDoc = await fetch(initDocUrl);
  if (!initDoc.ok) {
    throw new Error(
      `拉取 ${initDocUrl} 失败：HTTP ${initDoc.status}。` +
        `niceeval@${resolvedVersion} 对应的 GitHub tag 可能没有 INIT.md（早期版本、或 tag 名与版本号对不上），换一个更新的版本试试。`,
    );
  }
  initDocText = await initDoc.text();
}

const bytes = readFileSync(resolve(CANDIDATE_DIR, "niceeval.tgz"));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const version = resolvedVersion;

writeFileSync(resolve(CANDIDATE_DIR, "INIT.md"), initDocText);

writeFileSync(
  resolve(CANDIDATE_DIR, "manifest.json"),
  JSON.stringify({ version, sha256, source }, null, 2) + "\n",
);

console.log(`\n候选包就绪：niceeval@${version}`);
console.log(`  sha256: ${sha256}`);
console.log(`  来源:   ${source}`);
