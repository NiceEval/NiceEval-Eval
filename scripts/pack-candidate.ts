/**
 * 准备候选包：把「这次要评的那个 niceeval 构建」固化到 .candidate/ 下。
 *
 * 两种来源：
 *   pnpm run pack:candidate                    # 从 npm 取当前 latest
 *   pnpm run pack:candidate -- 0.9.1           # 从 npm 取指定版本
 *   pnpm run pack:candidate -- ../niceeval     # 从本地仓库现打一个（评还没发布的构建）
 *
 * 同时把安装前引导文档 INIT.md 抓下来一并固化——评估过程除被测模型外不该依赖任何外部服务，
 * 每次运行现抓会让「官网今天改了文案」变成分数波动。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATE_DIR = resolve(import.meta.dirname, "../.candidate");
const INIT_DOC_URL = "https://niceeval.com/INIT.md";

const target = process.argv[2] ?? "latest";
const isLocalRepo = target.startsWith(".") || target.startsWith("/");

rmSync(CANDIDATE_DIR, { recursive: true, force: true });
mkdirSync(CANDIDATE_DIR, { recursive: true });

let source: string;
let resolvedVersion: string;

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
}

const bytes = readFileSync(resolve(CANDIDATE_DIR, "niceeval.tgz"));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const version = resolvedVersion;

console.log("抓取安装前引导文档 INIT.md");
const initDoc = await fetch(INIT_DOC_URL);
if (!initDoc.ok) {
  throw new Error(`拉取 ${INIT_DOC_URL} 失败：HTTP ${initDoc.status}`);
}
writeFileSync(resolve(CANDIDATE_DIR, "INIT.md"), await initDoc.text());

writeFileSync(
  resolve(CANDIDATE_DIR, "manifest.json"),
  JSON.stringify({ version, sha256, source }, null, 2) + "\n",
);

console.log(`\n候选包就绪：niceeval@${version}`);
console.log(`  sha256: ${sha256}`);
console.log(`  来源:   ${source}`);
