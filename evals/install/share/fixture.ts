/**
 * install eval 的共用基础设施：把宿主仓库 clone 进沙箱。
 *
 * 这一步对所有接入路径都是机械的、纯操作性的——「clone 哪个 repo/tag」跟「这道题
 * 该发什么指令、该断言什么」无关，所以留在这里当工具函数。发给 agent 的任务文案
 * 与三层断言（检查 niceeval 是否安装好/产出质量层/评估是否正确加载文档）不在这里：每条接入路径的
 * 核心用例、宿主协议、合格文档落点都不一样，各 eval 文件自己写。
 *
 * 目前 install 与 undo 两组接入路径 eval 共用它(undo 未来会并入 install)。
 */

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "niceeval";
import { locateInstallRoot } from "./checks-generic.ts";

export interface FixtureRepo {
  /** fixture 宿主项目的 git 仓库地址（公开只读 clone） */
  repoUrl: string;
  /** 锁定的 tag（某次具体的大版本发布），固定住被测宿主的行为，不随上游新提交漂移 */
  ref: string;
  /**
   * 仓库体积过大时，只 sparse-checkout 排除这些顶层目录（如文档站、图片素材）。
   * 省略 = 整个仓库都要，适合体积不大的宿主。
   */
  excludeDirs?: string[];
}

/**
 * 把 fixture 锁定的 tag clone 进沙箱工作区。
 *
 * 直接对着一个真实开源仓库跑，而不是签入静态快照：宿主是谁的行为跑分随时可核对
 * （对着同一个 ref 重新 clone 得到同样的文件），但也意味着体积可能很大——
 * `excludeDirs` 用 sparse-checkout 剪掉体积大又与「装 niceeval」无关的目录。
 *
 * clone 完立刻删 `.git`：宿主自带的历史与 niceeval 自己的 git 基线是两回事，
 * 留着它只会带来歧义，不带来任何断言用得上的信息。
 */
function cloneScript(repo: FixtureRepo): string {
  if (!repo.excludeDirs?.length) {
    return `set -e
git clone --quiet --depth 1 --branch '${repo.ref}' --single-branch '${repo.repoUrl}' .
rm -rf .git`;
  }

  const sparsePattern = ["/*", ...repo.excludeDirs.map((d) => `!/${d}/`)].join("\n");
  return `set -e
git init -q
git remote add origin '${repo.repoUrl}'
git sparse-checkout init --no-cone
cat > .git/info/sparse-checkout <<'EOF'
${sparsePattern}
EOF
git fetch --quiet --depth 1 --filter=blob:none origin 'refs/tags/${repo.ref}'
git checkout --quiet FETCH_HEAD
rm -rf .git`;
}

export interface SandboxRunShell {
  runShell(script: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export async function cloneFixture(sandbox: SandboxRunShell, repo: FixtureRepo): Promise<void> {
  const result = await sandbox.runShell(cloneScript(repo));
  if (result.exitCode !== 0) {
    throw new Error(
      `clone fixture ${repo.repoUrl}@${repo.ref} failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
    );
  }
}

// downloadDirectory 的 opts.ignore 按 basename 排除（同 uploadDirectory）——这几个是宿主项目里
// 常见的噪声目录，跟「装 niceeval」无关，不该经网络原样搬一遍。
export const DEFAULT_SOURCE_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];

/**
 * 把 agent 手写的 .ts 源码带路径头串成一份 judge 材料。
 *
 * niceeval 的 sandbox 不设「按扩展名过滤的批量读取器」——批量取回只有 downloadDirectory
 * 一个原样搬运的 API（字节精确、不做过滤/拼接），筛选是普通代码的事（见
 * docs/feature/sandbox/library/operations.md）。这里现下载进一个临时目录，本地用
 * node:fs 筛 .ts 文件、拼成文本，用完即删——写法约定同 checks-generic.ts：判定/整理
 * 交给紧跟着的 judge，这一层只负责取证。
 */
export async function agentSourceMaterial(
  sandbox: TestContext["sandbox"],
  extraIgnoreDirs: string[] = [],
): Promise<string> {
  const at = (await locateInstallRoot(sandbox)) ?? ".";
  const staging = await mkdtemp(join(tmpdir(), "niceeval-agent-source-"));
  try {
    await sandbox.downloadDirectory(staging, at, {
      ignore: [...DEFAULT_SOURCE_IGNORE_DIRS, ...extraIgnoreDirs],
    });
    const paths = (await readdir(staging, { recursive: true })).filter((p) => p.endsWith(".ts"));
    if (paths.length === 0) return "（无）";
    const parts = await Promise.all(
      paths.map(async (p) => `\n// ${p}\n${await readFile(join(staging, p), "utf-8")}`),
    );
    return parts.join("\n");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
