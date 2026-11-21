import type { Shell } from "./query.ts";
import { shellQuote } from "./shell.ts";

const CLI = "./node_modules/.bin/niceeval";

type Diagnostic = { code?: string; summary?: string; summaryTruncated?: boolean };

/** 当前 show execution 与旧版公开 query attempt.trace 暴露同一诊断切片。 */
export async function attemptTraceReader(shell: Shell) {
  const help = await shell(`${CLI} --help`);
  if (help.exitCode !== 0) throw new Error(`无法发现 niceeval 的公开诊断入口：${help.stderr}`);
  let protocol: string | undefined;
  if (/^\s*niceeval query(?:\s|$)/m.test(help.stdout)) {
    const discovery = await shell(`${CLI} query discover`);
    if (discovery.exitCode !== 0) throw new Error(`niceeval query discover 失败：${discovery.stderr}`);
    const document = JSON.parse(discovery.stdout);
    if (!["niceeval.query/v2", "niceeval.query/v3"].includes(document.protocol) ||
        !document.operations?.some((operation: { id: string }) => operation.id === "attempt.trace")) {
      throw new Error("候选版本未提供公开 attempt.trace 诊断入口");
    }
    protocol = document.protocol;
  }

  return async (locator: string): Promise<{ diagnostics?: { items?: Diagnostic[] } }> => {
    if (!/^@[A-Za-z0-9]+$/.test(locator)) throw new Error(`无效的公开 Attempt locator：${locator}`);
    const request = JSON.stringify({ protocol, operation: { kind: "attempt.trace", locator } });
    const command = protocol
      ? `printf '%s' ${shellQuote(request)} | ${CLI} query run --request -`
      : `${CLI} show ${shellQuote(locator)} execution --json`;
    const result = await shell(command);
    if (result.exitCode !== 0) throw new Error(`读取 ${locator} 的公开执行记录失败：${result.stderr}`);
    const document = JSON.parse(result.stdout);
    if (document.operation !== "attempt.trace" || document.outcome !== "success" ||
        (document.issues?.length ?? 0) > 0 || document.trace == null) {
      throw new Error(`读取 ${locator} 的公开执行记录不完整`);
    }
    return document.trace;
  };
}
