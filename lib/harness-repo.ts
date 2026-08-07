/**
 * harness 题的共用执行机械：上传 folder-local 起始仓库、恢复被宿主 discovery 屏蔽的
 * TypeScript 文件、安装历史结果对应的 reader，并按 experiment flag 决定是否注入 agent rules。
 *
 * 题目、答案与 repo 资产仍全部归各自的 evals/harness/<id>/；
 * 这里不保存题库，也不决定判分。
 */

import type { BaseAssertionHandle, BaseTestContext } from "niceeval";
import { isTrue } from "niceeval/expect";

/** 禁止绕开公共 CLI 直接读取 .niceeval 内部 JSON。 */
export const RAW_RESULT_RE = /\.niceeval\/[\w./-]*\.json/;

/** 诊断题只读历史结果，不能真的启动实验。 */
export const EXP_COMMAND_RE =
  /(?:^|(?:&&|\|\||;|\|)\s*|(?:^|\s)(?:\/bin\/)?(?:ba|z)?sh\s+-lc\s+["'])(?:(?:pnpm\s+(?:--silent\s+)?exec|npx(?:\s+--yes)?)\s+|(?:\.\/)?node_modules\/\.bin\/)?niceeval\s+exp\b/m;

/** 至少使用过一次结果查询入口。 */
export const SHOW_COMMAND_RE =
  /(?:^|(?:&&|\|\||;|\|)\s*|(?:^|\s)(?:\/bin\/)?(?:ba|z)?sh\s+-lc\s+["'])(?:(?:pnpm\s+(?:--silent\s+)?exec|npx(?:\s+--yes)?)\s+|(?:\.\/)?node_modules\/\.bin\/)?niceeval\s+show\b/m;

/**
 * 把用例自己的 repo/ 物化为 agent 看到的完整仓库。
 *
 * repo 在宿主 evals/ 树下，因此其中所有 TypeScript 源文件都以 `.fixture` 结尾，避免被宿主
 * TypeScript 与 NiceEval discovery 扫入；上传后统一去掉这个传输后缀。这个恢复步骤发生在
 * t.send() 前，不会计入 agent diff。
 */
export async function prepareHarnessRepo<H extends BaseAssertionHandle>(
  t: BaseTestContext<H>,
  repo: URL,
): Promise<void> {
  const version = t.flags.candidateVersion as string;

  await uploadHarnessRepo(t, repo);

  const install = await t.sandbox.runCommand("pnpm", ["add", "-D", `niceeval@${version}`]);
  if (install.exitCode !== 0) {
    throw new Error(`历史结果 reader 安装失败：\n${install.stderr || install.stdout}`);
  }

  if (t.flags.agentRules !== false) {
    const init = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "init"]);
    if (init.exitCode !== 0) {
      throw new Error(`niceeval init 失败，实验组自变量没有建立：\n${init.stderr || init.stdout}`);
    }
  }
}

/** 上传 folder-local repo，并恢复为避免宿主 discovery 而加上的 `.fixture` 后缀。 */
export async function uploadHarnessRepo<H extends BaseAssertionHandle>(
  t: BaseTestContext<H>,
  repo: URL,
): Promise<void> {

  await t.sandbox.uploadDirectory(repo);

  const materialize = await t.sandbox.runShell(
    "find . -type f \\( -name '*.ts.fixture' -o -name '*.tsx.fixture' \\) " +
      "-exec sh -c 'for source_file do mv \"$source_file\" \"${source_file%.fixture}\"; done' sh {} +",
  );
  if (materialize.exitCode !== 0) {
    throw new Error(
      `起始仓库的 TypeScript 文件恢复失败：\n${materialize.stderr || materialize.stdout}`,
    );
  }
}

/** 所有 harness 题共有的只读边界；具体答案和 CLI 下钻路径仍由每题自己断言。 */
export function assertReadOnlyHarness<H extends BaseAssertionHandle>(t: BaseTestContext<H>): void {
  t.notCalledTool("shell", { input: { command: RAW_RESULT_RE } });
  t.notCalledTool("shell", { input: { command: EXP_COMMAND_RE } });
  t.check(t.sandbox.diff.isEmpty(), isTrue("没有修改起始仓库"));
}
