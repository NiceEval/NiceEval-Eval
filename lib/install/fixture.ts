/**
 * install eval 的共用基础设施：把精确锁定的宿主仓库检出进沙箱。
 *
 * 这一步对所有接入路径都是机械的、纯操作性的——「检出哪个 repo/commit」跟「这道题
 * 该发什么指令、该断言什么」无关，所以留在这里当工具函数。发给 agent 的任务文案
 * 与三层断言（检查 niceeval 是否安装好/产出质量层/评估是否正确加载文档）不在这里：每条接入路径的
 * 核心用例、宿主协议、合格文档落点都不一样，各 eval 文件自己写。
 *
 * 目前 install 下五条接入路径 eval 共用它。
 */

import type { ScoreTestContext } from "niceeval";
import {
  actionRef,
  command,
  gitCheckout,
  sandboxLayer,
} from "niceeval/sandbox";
import { locateInstallRoot } from "./installation.ts";

const FIXTURE_CHECKOUT_FREQUENCY = 20;

/**
 * `FixtureRepo.ref` 继续保留题库的人读版本名；真正进入 action identity 的必须是完整 commit。
 * 这些 lightweight tag 的值在迁移时从各自公开 origin 解析并固定，后续 tag 移动不会静默换题。
 */
const LOCKED_FIXTURE_COMMITS = new Map<string, { id: string; commit: string }>([
  [
    "https://github.com/eosphoros-ai/DB-GPT.git#v0.8.1",
    { id: "db-gpt-v0.8.1", commit: "177bfc84f77e7f7760c055a748b0e4bb82d9fa47" },
  ],
  [
    "https://github.com/assafelovic/gpt-researcher.git#v3.6.0",
    { id: "gpt-researcher-v3.6.0", commit: "5d84d2f5553e70a2765a8ff3a0d2672d60437ce8" },
  ],
  [
    "https://github.com/OpenHands/OpenHands.git#1.11.0",
    { id: "openhands-1.11.0", commit: "11ca68ab2e15dcd85c21e4d7d3409e7a259369ac" },
  ],
  [
    "https://github.com/letta-ai/letta.git#0.16.8",
    { id: "letta-0.16.8", commit: "1131535716e8a31c9a437f8695e25ac98f203a24" },
  ],
  [
    "https://github.com/expressjs/express.git#4.21.2",
    { id: "express-4.21.2", commit: "1faf228935aa0a13111f92c28ee795be64ce3f0f" },
  ],
  [
    "https://github.com/Skyvern-AI/skyvern.git#v1.0.47",
    { id: "skyvern-v1.0.47", commit: "9fc0b2aee079ee34ae3cdb578ca346f06c733218" },
  ],
]);

export interface FixtureRepo {
  /** fixture 宿主项目的 git 仓库地址（公开只读 checkout） */
  repoUrl: string;
  /** 人读 release tag；执行时由本文件的 lock table 固化到完整 commit。 */
  ref: string;
  /**
   * 仓库体积过大时，只 sparse-checkout 排除这些顶层目录（如文档站、图片素材）。
   * 省略 = 整个仓库都要，适合体积不大的宿主。
   */
  excludeDirs?: readonly string[];
}

/**
 * 把外部宿主放进 Sandbox 基线，而不是算成 agent 的工作区改动。eval 只声明要哪份 fixture；
 * 完整 commit 的 checkout 在 workspace.baseline 之前完成，大仓库不会挤爆 diff，test(t) 也只
 * 保留任务与检查。checkout 后继续删除上游 `.git`，保留旧 helper 的 agent 可见起点。
 */
export function fixtureSandbox(repo: FixtureRepo) {
  const locked = LOCKED_FIXTURE_COMMITS.get(`${repo.repoUrl}#${repo.ref}`);
  if (locked === undefined) {
    throw new Error(
      `fixture ${repo.repoUrl}@${repo.ref} 没有固定完整 commit；先在可信流程解析并登记后才能声明 action。`,
    );
  }
  const checkoutId = `niceeval-eval.install-fixture.${locked.id}.checkout`;
  const detachId = `niceeval-eval.install-fixture.${locked.id}.detach`;
  return sandboxLayer()
    .before(gitCheckout({
      id: checkoutId,
      repository: repo.repoUrl,
      ref: locked.commit,
      to: ".",
      ...(repo.excludeDirs?.length
        ? {
            sparse: {
              include: ["/*"],
              exclude: repo.excludeDirs.map((directory) => `/${directory}/`),
            },
          }
        : {}),
      changeFrequency: FIXTURE_CHECKOUT_FREQUENCY,
    }))
    .before(command("rm", ["-rf", ".git"], {
      id: detachId,
      changeFrequency: FIXTURE_CHECKOUT_FREQUENCY + 1,
      dependsOn: [actionRef(checkoutId)],
    }));
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
