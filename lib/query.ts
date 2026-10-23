/**
 * 在被测项目里调用它自己安装的 niceeval CLI。只负责传输：返回 `niceeval.query/v2` 文档或
 * `exp --json` receipt 原样字段，不认识任何业务概念；判据写在各 Eval 正文里。
 *
 * `shell` 在被测项目根目录执行一段 sh（Eval 里是 `(s) => t.sandbox.runShell(s)`）。
 * request 经 stdin 传给 `query run --request -`，不在工作区写临时文件。
 */

export type Shell = (script: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// query 文档是 CLI 的公开 JSON；字段按 niceeval.query/v2 直接读取。
export type QueryDocument = any;

const CLI = "./node_modules/.bin/niceeval";

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 执行一个固定 Inspection operation。选择对象不存在（`inspection-selection-missing`，
 * 例如 agent 从没跑过这个 Experiment）返回 null；其它失败或带 issues 的结果抛错，
 * 让外层 Attempt 记为 errored，而不是把读不到的证据当成零分。
 */
export async function query(shell: Shell, operation: Record<string, unknown>): Promise<QueryDocument | null> {
  const request = JSON.stringify({ protocol: "niceeval.query/v2", operation });
  const result = await shell(`printf '%s' ${quote(request)} | ${CLI} query run --request -`);
  let doc: QueryDocument;
  try {
    doc = JSON.parse(result.stdout);
  } catch {
    throw new Error(`niceeval query ${operation.kind} 没有输出 JSON 文档：${result.stderr || result.stdout}`);
  }
  if (doc.outcome === "failure" && doc.failure?.code === "inspection-selection-missing") return null;
  if (doc.outcome !== "success" || (doc.issues ?? []).length > 0) {
    throw new Error(`niceeval query ${operation.kind} 证据不可用：${JSON.stringify(doc.failure ?? doc.issues)}`);
  }
  return doc;
}

/** 运行一次 `niceeval exp <args> --json`，返回退出码与最后一行 receipt 的 createdRunIds。 */
export async function exp(shell: Shell, args: readonly string[]): Promise<{ exitCode: number; runIds: string[] }> {
  const result = await shell(`${CLI} exp ${args.map(quote).join(" ")} --json`);
  const last = result.stdout.trim().split("\n").at(-1) ?? "";
  let receipt: { receipt?: { createdRunIds?: string[] } };
  try {
    receipt = JSON.parse(last);
  } catch {
    throw new Error(`niceeval exp ${args.join(" ")} 没有输出 receipt：${result.stderr.slice(-2000)}`);
  }
  return { exitCode: result.exitCode, runIds: receipt.receipt?.createdRunIds ?? [] };
}
