/**
 * 在被测项目里调用它自己安装的 niceeval CLI。只负责传输：发现公开出口后返回 Inspection 文档或
 * `exp --json` receipt 原样字段，外加抹平 v2/v3 字段位置的 verdict 投影；不认识任何业务概念，
 * 判据写在各 Eval 正文里。
 *
 * `shell` 在被测项目根目录执行一段 sh（Eval 里是 `(s) => t.sandbox.runShell(s)`）。
 * 历史 query request 经 stdin 传入；当前 show 使用对象地址，不在工作区写临时文件。
 */

import { shellQuote } from "./shell.ts";

export type Shell = (script: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// Inspection 文档是 CLI 的公开 JSON；历史 query v2/v3 与当前 show 的字段由各判据读取。
export type QueryDocument = any;

// Query v3 把 verdict 放在成员上，稳定版的 v2 放在 publication 里。
type Cell = { evalId: string; members: { verdict?: string | null; publication?: { verdict?: string; attemptId?: string; attemptLocator?: string } }[] };

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

/**
 * project.get 的当前结果：每一格的每个成员。局部补跑不丢弃其它格，较早的成功也不掩盖后来的失败。
 * 未发布的成员没有 locator。
 */
export function currentAttempts(doc: { project: { cells: (Cell & { experimentId: string })[] } } | null) {
  return (doc?.project.cells ?? []).flatMap((cell) => cell.members.map((member) => ({
    experimentId: cell.experimentId,
    evalId: cell.evalId,
    locator: member.publication?.attemptLocator ?? null,
    verdict: member.verdict ?? member.publication?.verdict ?? null,
  })));
}

const CLI = "./node_modules/.bin/niceeval";
type InspectionExit = { kind: "show" } | { kind: "query"; protocol: string; operations: { id: string }[] };
const discoveries = new WeakMap<Shell, Promise<InspectionExit>>();

function readDocument(result: Awaited<ReturnType<Shell>>, context: string): QueryDocument {
  try {
    const doc = JSON.parse(result.stdout);
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) throw new Error("not a document");
    return doc;
  } catch {
    throw new Error(`niceeval ${context} 没有输出 JSON 文档：${result.stderr || result.stdout}`);
  }
}

async function discover(shell: Shell) {
  let pending = discoveries.get(shell);
  if (pending === undefined) {
    pending = (async (): Promise<InspectionExit> => {
      const help = await shell(`${CLI} --help`);
      if (help.exitCode !== 0) throw new Error(`niceeval 能力发现失败：${help.stderr || help.stdout}`);
      if (!/^\s*niceeval query(?:\s|$)/m.test(help.stdout)) {
        if (!/^\s*niceeval show(?:\s|$)/m.test(help.stdout)) throw new Error("niceeval 未提供 query 或 show 出口");
        return { kind: "show" };
      }
      const result = await shell(`${CLI} query discover`);
      const doc = readDocument(result, "query discover");
      if (result.exitCode !== 0 || doc.outcome !== "discovery" ||
          !["niceeval.query/v2", "niceeval.query/v3"].includes(doc.protocol) || !Array.isArray(doc.operations) ||
          !doc.operations.every((op: { id?: unknown } | null) => op !== null && typeof op.id === "string")) {
        throw new Error(`niceeval query discovery 不支持：${result.stderr || result.stdout}`);
      }
      return { kind: "query", protocol: doc.protocol, operations: doc.operations };
    })();
    discoveries.set(shell, pending);
  }
  return pending;
}

/** 只支持本仓库已确定的四种读取，不静默丢弃当前 show 无法表达的筛选字段。 */
function showAddress(operation: Record<string, unknown>): string[] {
  const id = (field: string, prefix: string) => {
    if (typeof operation[field] !== "string" || operation[field].length === 0) {
      throw new Error(`niceeval Inspection ${operation.kind} 缺少 ${field}`);
    }
    return [`${prefix}:${operation[field]}`];
  };
  let fields: string[] = [];
  let address: string[];
  switch (operation.kind) {
    case "project.get": address = []; break;
    case "run.list": address = ["runs"]; break;
    case "experiment.get": fields = ["experimentId"]; address = id("experimentId", "exp"); break;
    case "run.get": fields = ["runId"]; address = id("runId", "run"); break;
    default: throw new Error(`niceeval Inspection 未提供 operation：${operation.kind}`);
  }
  if (Object.keys(operation).some((key) => key !== "kind" && !fields.includes(key))) {
    throw new Error(`niceeval Inspection ${operation.kind} 有不支持的参数`);
  }
  return address;
}

/**
 * 执行一个固定 Inspection operation。选择对象不存在（`inspection-selection-missing`，
 * 例如 agent 从没跑过这个 Experiment）返回 null；其它失败或带 issues 的结果抛错，
 * 让外层 Attempt 记为 errored，而不是把读不到的证据当成零分。
 */
export async function query(shell: Shell, operation: Record<string, unknown>): Promise<QueryDocument | null> {
  const address = showAddress(operation);
  const discovery = await discover(shell);
  let command: string;
  if (discovery.kind === "query") {
    if (!discovery.operations.some(({ id }) => id === operation.kind)) {
      throw new Error(`niceeval query 未提供 operation：${operation.kind}`);
    }
    const request = JSON.stringify({ protocol: discovery.protocol, operation });
    command = `printf '%s' ${shellQuote(request)} | ${CLI} query run --request -`;
  } else {
    command = `${CLI} show ${[...address, "--json"].map(shellQuote).join(" ")}`;
  }
  const result = await shell(command);
  const context = `${discovery.kind} ${operation.kind}`;
  const doc = readDocument(result, context);
  if (doc.operation !== operation.kind) {
    throw new Error(`niceeval ${context} operation 不匹配：${JSON.stringify(doc.operation)}`);
  }
  if (!Array.isArray(doc.issues ?? [])) throw new Error(`niceeval ${context} issues 格式无效`);
  if ((doc.issues ?? []).length > 0) throw new Error(`niceeval ${context} 证据不可用：${JSON.stringify(doc.issues)}`);
  if (doc.outcome === "failure" && doc.failure?.code === "inspection-selection-missing") return null;
  if (result.exitCode !== 0 || doc.outcome !== "success") {
    throw new Error(`niceeval ${context} 证据不可用：${JSON.stringify(doc.failure ?? doc.issues)} ${result.stderr}`);
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

/** 被测项目当前公开的全部 Run ID。读不到列表时抛错。 */
export async function runIds(shell: Shell): Promise<string[]> {
  const doc = await query(shell, { kind: "run.list" });
  if (!Array.isArray(doc?.runs)) throw new Error("niceeval run.list 没有给出 Run 列表");
  return doc.runs.map((run: { runId: string }) => run.runId);
}

/**
 * 某道题在某个 Experiment 下当前发布的 Attempt（每格 1 次）。没跑过返回 null；
 * 已发布却缺 locator 时抛错，不把“看不出是哪次结果”当成没有结果。
 */
export async function publishedAttempt(
  shell: Shell, experimentId: string, evalId: string,
): Promise<{ verdict: string | null; locator: string; attempts: number } | null> {
  const doc = await query(shell, { kind: "experiment.get", experimentId });
  const members: Cell["members"] = doc?.experiment.cells.find((cell: Cell) => cell.evalId === evalId)?.members ?? [];
  const [first] = members;
  if (first?.publication === undefined) return null;
  const locator = first.publication.attemptLocator;
  if (typeof locator !== "string") throw new Error(`${experimentId} × ${evalId} 已发布但缺少 Attempt locator`);
  return { verdict: first.verdict ?? first.publication.verdict ?? null, locator, attempts: members.length };
}

/** 不在 `previous` 里的新 Run 中，每个 Attempt 的 publication action（executed、carried 等）。 */
export async function publicationActionsSince(shell: Shell, previous: readonly string[]): Promise<string[]> {
  const actions: string[] = [];
  for (const runId of (await runIds(shell)).filter((id) => !previous.includes(id))) {
    const doc = await query(shell, { kind: "run.get", runId });
    if (!Array.isArray(doc?.run.plannedAttempts)) throw new Error(`Run ${runId} 缺少 Attempt 列表`);
    for (const slot of doc.run.plannedAttempts) {
      if (typeof slot.publication?.action !== "string") throw new Error(`Run ${runId} 的发布证据不完整`);
      actions.push(slot.publication.action);
    }
  }
  return actions;
}

/**
 * `niceeval exp <experiment> <evalId> --dry --json` 对这一格的预览：总格数、沿用数，以及沿用来源的 locator 与 verdict。
 * 预览失败返回 exitCode 非 0 与 null 字段，由判据显示实际值。
 */
export async function dryReuse(shell: Shell, experimentId: string, evalId: string) {
  const result = await shell(`${CLI} exp ${[experimentId, evalId, "--dry", "--json"].map(shellQuote).join(" ")}`);
  if (result.exitCode !== 0) return { exitCode: result.exitCode, total: null, reused: null, locator: null, verdict: null };
  const plan = readDocument(result, "exp --dry");
  const row = plan.matrix?.find((pair: { experimentId: string; evalId: string }) =>
    pair.experimentId === experimentId && pair.evalId === evalId);
  const source = row?.readbacks?.[0];
  if (plan.reused === 1 && row !== undefined && typeof source?.source?.locator !== "string") {
    throw new Error("预览报告沿用，但没有给出来源 Attempt locator，无法核验");
  }
  return { exitCode: 0, total: plan.total, reused: plan.reused, locator: source?.source?.locator ?? null, verdict: source?.verdict ?? null };
}
