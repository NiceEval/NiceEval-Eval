import type { EvalSandbox, O11ySummary } from "niceeval";

type WorkspaceReader = Pick<EvalSandbox, "readText" | "runCommand">;

/** 列出 agent 可改的项目文件；运行结果不属于交付 diff。 */
export async function listWorkspaceFiles(sandbox: WorkspaceReader): Promise<string[]> {
  const result = await sandbox.runCommand("find", [
    ".",
    "-type",
    "f",
    "!",
    "-path",
    "./.niceeval/*",
    "-print",
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);

  return result.stdout
    .split("\n")
    .map((file) => file.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .sort();
}

/** 对明确禁止修改的文件做逐字节快照。 */
export async function readFiles(
  sandbox: WorkspaceReader,
  files: readonly string[],
): Promise<string[]> {
  return Promise.all(files.map((file) => sandbox.readText(file)));
}

/** 给 judge 的不是 agent 自述，而是自述与宿主不可伪造的本轮命令事实。 */
export function turnEvidence(
  candidateVersion: string,
  assistantReply: string,
  shellCommandsObservedByHost: O11ySummary["shellCommands"],
): string {
  return JSON.stringify({ candidateVersion, assistantReply, shellCommandsObservedByHost });
}
