/**
 * 在被测项目里调用它自己安装的 niceeval CLI。只负责传输：发现协议版本后返回 Query 文档或
 * `exp --json` receipt 原样字段，外加抹平 v2/v3 字段位置的 verdict 投影；不认识任何业务概念，
 * 判据写在各 Eval 正文里。
 *
 * `shell` 在被测项目根目录执行一段 sh（Eval 里是 `(s) => t.sandbox.runShell(s)`）。
 * request 经 stdin 传给 `query run --request -`，不在工作区写临时文件。
 */

import { shellQuote } from "./shell.ts";

export type Shell = (script: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// query 文档是 CLI 的公开 JSON；稳定版 v2 与 Canary v3 的字段由各判据按协议读取。
export type QueryDocument = any;

// Query v3 把 verdict 放在成员上，稳定版的 v2 放在 publication 里。
type Cell = { evalId: string; members: { verdict?: string | null; publication?: { verdict?: string; attemptId?: string } }[] };

/** experiment.get 的当前结果：evalId → 已发布 verdict（每格 1 次 Attempt）。没跑过为空表。 */
export function currentVerdicts(doc: { experiment: { cells: Cell[] } } | null): Record<string, string | null> {
  return Object.fromEntries((doc?.experiment.cells ?? []).map((c) =>
    [c.evalId, c.members[0]?.verdict ?? c.members[0]?.publication?.verdict ?? null]));
}

/**
 * experiment.get 的当前结果：evalId → 当前发布的 Attempt ID。同一个 ID 表示这一格沿用了旧结果，没有重新执行。
 * 读不到 ID 时抛错，不把「看不出有没有重跑」当成「没重跑」。
 */
export function currentAttemptIds(doc: { experiment: { cells: Cell[] } } | null): Record<string, string> {
  return Object.fromEntries((doc?.experiment.cells ?? []).map((c) => {
    const id = c.members[0]?.publication?.attemptId;
    if (id === undefined) throw new Error(`niceeval query experiment.get 没有给出 ${c.evalId} 的 Attempt ID`);
    return [c.evalId, id];
  }));
}

const CLI = "./node_modules/.bin/niceeval";
const discoveries = new WeakMap<Shell, Promise<{ protocol: string; operations: { id: string }[] }>>();

async function discover(shell: Shell) {
  let pending = discoveries.get(shell);
  if (pending === undefined) {
    pending = (async () => {
      const result = await shell(`${CLI} query discover`);
      const doc = JSON.parse(result.stdout);
      if (result.exitCode !== 0 || doc.outcome !== "discovery" ||
          !["niceeval.query/v2", "niceeval.query/v3"].includes(doc.protocol) || !Array.isArray(doc.operations)) {
        throw new Error(`niceeval query discovery 不支持：${result.stderr || result.stdout}`);
      }
      return doc as { protocol: string; operations: { id: string }[] };
    })();
    discoveries.set(shell, pending);
  }
  return pending;
}


/**
 * 执行一个固定 Inspection operation。选择对象不存在（`inspection-selection-missing`，
 * 例如 agent 从没跑过这个 Experiment）返回 null；其它失败或带 issues 的结果抛错，
 * 让外层 Attempt 记为 errored，而不是把读不到的证据当成零分。
 */
export async function query(shell: Shell, operation: Record<string, unknown>): Promise<QueryDocument | null> {
  const discovery = await discover(shell);
  if (!discovery.operations.some(({ id }) => id === operation.kind)) {
    throw new Error(`niceeval query 未提供 operation：${operation.kind}`);
  }
  const request = JSON.stringify({ protocol: discovery.protocol, operation });
  const result = await shell(`printf '%s' ${shellQuote(request)} | ${CLI} query run --request -`);
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
  const result = await shell(`${CLI} exp ${args.map(shellQuote).join(" ")} --json`);
  const last = result.stdout.trim().split("\n").at(-1) ?? "";
  let receipt: { receipt?: { createdRunIds?: string[] } };
  try {
    receipt = JSON.parse(last);
  } catch {
    throw new Error(`niceeval exp ${args.join(" ")} 没有输出 receipt：${result.stderr.slice(-2000)}`);
  }
  return { exitCode: result.exitCode, runIds: receipt.receipt?.createdRunIds ?? [] };
}

/**
 * 运行一次 `niceeval exp`，再从 receipt 里唯一的 Run 读回本次每个用例的终态与 publication action。
 * 只读公开 JSON，不解析终端汇总文案；没有恰好创建一个 Run 时抛错。
 */
export async function runOnce(shell: Shell, args: readonly string[]): Promise<{
  exitCode: number;
  runId: string;
  results: Record<string, string | null>;
  actions: (string | null)[];
}> {
  const { exitCode, runIds } = await exp(shell, args);
  const [runId] = runIds;
  if (runId === undefined || runIds.length !== 1) {
    throw new Error(`niceeval exp ${args.join(" ")} 应创建恰好一个 Run，实际 ${JSON.stringify(runIds)}`);
  }
  const attempts: { evalId: string; verdict?: string | null; publication?: { action?: string } }[] =
    (await query(shell, { kind: "run.get", runId })).run.plannedAttempts;
  return {
    exitCode,
    runId,
    results: Object.fromEntries(attempts.map((a) => [a.evalId, a.verdict ?? null])),
    actions: attempts.map((a) => a.publication?.action ?? null),
  };
}
