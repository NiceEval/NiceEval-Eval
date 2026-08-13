/**
 * install eval 的共用基础设施：把宿主仓库 clone 进沙箱。
 *
 * 这一步对所有接入路径都是机械的、纯操作性的——「clone 哪个 repo/tag」跟「这道题
 * 该发什么指令、该断言什么」无关，所以留在这里当工具函数。发给 agent 的任务文案
 * 与三层断言（检查 niceeval 是否安装好/产出质量层/评估是否正确加载文档）不在这里：每条接入路径的
 * 核心用例、宿主协议、合格文档落点都不一样，各 eval 文件自己写。
 *
 * 目前 install 下五条接入路径 eval 共用它。
 */

import type { ScoreTestContext } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import { locateInstallRoot } from "./installation.ts";

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
 * 普通 clone 先落到临时目录，再把工作树复制进沙箱：NiceEval 在 eval.run 前会在 workdir
 * 创建 `__niceeval__/results.json`，所以不能假设目标 `.` 为空。复制前删掉上游 `.git`：
 * 宿主自带的历史与 niceeval 自己的 git 基线是两回事，留着它只会带来歧义。
 */
function cloneScript(repo: FixtureRepo): string {
  if (!repo.excludeDirs?.length) {
    return `set -e
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
git clone --quiet --depth 1 --branch '${repo.ref}' --single-branch '${repo.repoUrl}' "$fixture_dir"
rm -rf "$fixture_dir/.git"
cp -a "$fixture_dir"/. .
rm -rf "$fixture_dir"
trap - EXIT`;
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

/**
 * 把外部宿主放进 Sandbox 基线，而不是算成 agent 的工作区改动。eval 只声明要哪份 fixture；
 * clone 在 workspace.baseline 之前完成，大仓库不会挤爆 diff，test(t) 也只保留任务与检查。
 */
export function fixtureSandbox(repo: FixtureRepo) {
  return sandboxLayer().setup(async (sandbox, ctx) => {
    ctx.progress({ message: `准备宿主 fixture：${repo.repoUrl}@${repo.ref}` });
    await cloneFixture(sandbox, repo);
  });
}

// judge 材料中应排除的常见宿主噪声目录。
export const DEFAULT_SOURCE_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 按一条列文件的命令，把 agent 手写的那几个文件带路径头取回沙箱外，供机械判据 grep。
 *
 * 与 collectAgentSource 的分工：那个是喂 judge 的**全量**材料（整个装机目录中剪枝后的
 * .ts 源码）；这个是喂 t.check 正则的**定向**取证——只要 adapter /
 * experiment / eval 里的某一族，一条命令列出路径、就地 cat，不落本地盘。
 *
 * 写法约定同各 eval-*.ts 头注：探针只取证不判定。`listCommand` 只负责一行一个路径地列出来
 * （`grep -rl` / `find`），拼接与 `// @file <路径>` 头由这里统一加，判定交给调用方紧跟的
 * t.check。头用 `@file` 而不是裸 `// <路径>`：源码里以 `// ` 开头的普通注释行满地都是，
 * 逐文件切分（见 splitAuthoredFiles）必须有个不会撞车的标记。
 * `head -20` 是防御性上限：agent 正常只会写三五个文件，真写了几十个也不该把整个沙箱读回来。
 */
export async function readAuthoredFiles(
  sandbox: ScoreTestContext["sandbox"],
  at: string,
  listCommand: string,
): Promise<string> {
  const probe = await sandbox.runShell(
    `{ ${listCommand} ; } 2>/dev/null | head -20 | while IFS= read -r f; do echo "// @file $f"; cat "$f"; done`,
    { cwd: at },
  );
  return probe.stdout;
}

/**
 * 把一份 readAuthoredFiles 的输出按 `// @file <路径>` 头切回逐文件。
 *
 * 「每个实验文件都写了 description」这类判据要逐文件判，不能整份文本一起 test——一个文件写了
 * 别的文件没写，整份也会命中。空数组表示一个文件都没取到。
 */
export function splitAuthoredFiles(source: string): string[] {
  return source
    .split(/^\/\/ @file (?=\S)/m)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 把 agent 手写的 .ts 源码带路径头串成一份 judge 材料。
 *
 * Docker 只读根文件系统的 downloadDirectory 会先在沙箱内打包整棵目录，再在宿主端应用
 * ignore；对把 niceeval 装在大型宿主仓库里的用例，这会把 node_modules 也经过 base64
 * 传回宿主。这里改为在沙箱内先剪枝，只把手写 .ts 文件带路径头拼成 judge 材料；
 * 判定/整理仍交给紧跟着的 judge，这一层只负责取证。
 */
export async function collectAgentSource(
  sandbox: ScoreTestContext["sandbox"],
  extraIgnoreDirs: string[] = [],
): Promise<string> {
  const at = (await locateInstallRoot(sandbox)) ?? ".";
  const ignored = [...new Set([...DEFAULT_SOURCE_IGNORE_DIRS, ...extraIgnoreDirs])];
  const prune = ignored.map((name) => `-name ${shellQuote(name)}`).join(" -o ");
  const result = await sandbox.runShell(
    `find . -type d \\( ${prune} \\) -prune -o -type f -name '*.ts' -print | while IFS= read -r f; do printf '\\n// %s\\n' "$f"; cat "$f"; done`,
    { cwd: at },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `collect agent TypeScript sources failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim().length === 0 ? "（无）" : result.stdout;
}
