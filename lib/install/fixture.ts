import type { ScoreTestContext } from "niceeval";
import { locateInstallRoot } from "./installation.ts";

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
