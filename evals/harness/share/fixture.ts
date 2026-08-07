import type { BaseAssertionHandle, BaseTestContext, CommandResult } from "niceeval";
import { uploadHarnessRepo } from "../../../lib/harness-repo.ts";

export const EXP_COMMAND_RE =
  /(?:(?:pnpm(?:\s+--silent)?\s+exec|npx(?:\s+--no-install)?)\s+niceeval|(?:\.\/)?node_modules\/\.bin\/niceeval)\s+exp\s+local\b/;
export const SHOW_COMMAND_RE = /niceeval\s+show\b/;
export const SHOW_LOCATOR_RE = /niceeval\s+show\s+@[A-Za-z0-9]+\b/;
export const RAW_RESULT_RE = /\.niceeval\/[\w./-]*\.json/;

async function requireCommand(result: CommandResult, label: string): Promise<void> {
  if (result.exitCode === 0) return;
  throw new Error(`${label}失败（exit ${result.exitCode}）：\n${result.stderr || result.stdout}`);
}

/** 上传确定性内层项目，装指定候选并刷新托管指引；这些步骤发生在 agent 第一轮之前。 */
export async function prepareCurrentProject<H extends BaseAssertionHandle>(
  t: BaseTestContext<H>,
  repo: URL,
  version: string,
): Promise<void> {
  await uploadHarnessRepo(t, repo);
  await requireCommand(
    await t.sandbox.runCommand("pnpm", ["add", "-D", `niceeval@${version}`]),
    `安装 niceeval@${version}`,
  );
  await requireCommand(await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "init"]), "niceeval init");
}

/** 旧项目保留 0.9.1 依赖与旧托管块，升级动作全部留给被测 agent。 */
export async function prepareLegacyProject<H extends BaseAssertionHandle>(
  t: BaseTestContext<H>,
  repo: URL,
): Promise<void> {
  await uploadHarnessRepo(t, repo);
  await requireCommand(await t.sandbox.runCommand("pnpm", ["install"]), "安装 legacy fixture");
  await requireCommand(await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "init"]), "legacy niceeval init");
}

export function runInnerExperiment<H extends BaseAssertionHandle>(
  t: BaseTestContext<H>,
  rerun = false,
): Promise<CommandResult> {
  return t.sandbox.runCommand("pnpm", [
    "--silent",
    "exec",
    "niceeval",
    "exp",
    "local",
    ...(rerun ? ["--rerun", "all"] : []),
    "--json",
  ]);
}
