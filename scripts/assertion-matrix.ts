/**
 * 把几个 Experiment 的当前结果按「判据 key × Experiment」排成矩阵，每个 Eval 一张表。
 * 用来校准 rubric：恒零或恒满的判据没有区分度，只在某个候选上丢分的判据才说明版本差异。
 * 只读公开 query（experiment.get → attempt.get → attempt.assertion.detail）。
 *
 *   pnpm assertion-matrix harness/v0.19.0 harness/v0.20.0 harness/canary [--eval <前缀>]
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { query, type Shell } from "../lib/query.ts";

const args = process.argv.slice(2);
const evalFlag = args.indexOf("--eval");
const evalPrefix = evalFlag === -1 ? "" : args[evalFlag + 1] ?? "";
const experimentIds = evalFlag === -1 ? args : args.filter((_, index) => index !== evalFlag && index !== evalFlag + 1);
if (experimentIds.length === 0) {
  throw new Error("Usage: pnpm assertion-matrix <experiment-id> [<experiment-id> ...] [--eval <eval-id-prefix>]");
}

// 一次矩阵要读上千条判据详情，所以用异步进程并发，不用 spawnSync。
const run = promisify(exec);
const shell: Shell = async (script) => {
  try {
    const { stdout, stderr } = await run(script, { maxBuffer: 64 * 1024 * 1024 });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: failed.code ?? 2, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
};

async function inBatches<T, R>(items: readonly T[], size: number, body: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...await Promise.all(items.slice(start, start + size).map(body)));
  }
  return results;
}

type Member = { verdict?: string | null; publication?: { attemptLocator?: string } };
type Entry = { entryId: string; display: { key?: string; label?: string } };

/** 一格里一条判据的读数：计分项是 `得分/满分`，不计分项是判定结果。 */
function reading(entry: { contribution?: { earned?: number; points?: number; state: string }; decision: { result: string } }): string {
  const { contribution, decision } = entry;
  if (contribution?.points !== undefined) {
    return contribution.earned === undefined ? `${decision.result}/${contribution.points}` : `${contribution.earned}/${contribution.points}`;
  }
  return decision.result;
}

// evalId → key → experimentId → 读数
const matrix = new Map<string, Map<string, Map<string, string>>>();
const totals = new Map<string, Map<string, string>>();

for (const experimentId of experimentIds) {
  const doc = await query(shell, { kind: "experiment.get", experimentId });
  if (doc === null) throw new Error(`Experiment ${experimentId} 没有结果`);
  const cells: { evalId: string; members: Member[] }[] = doc.experiment.cells;
  for (const cell of cells.filter(({ evalId }) => evalId.startsWith(evalPrefix))) {
    const locator = cell.members[0]?.publication?.attemptLocator;
    const rows = matrix.get(cell.evalId) ?? new Map<string, Map<string, string>>();
    matrix.set(cell.evalId, rows);
    const total = totals.get(cell.evalId) ?? new Map<string, string>();
    totals.set(cell.evalId, total);
    if (locator === undefined) {
      total.set(experimentId, "未发布");
      continue;
    }
    const attempt = (await query(shell, { kind: "attempt.get", locator })).attempt;
    const score = attempt.score?.earned === undefined ? "" : ` ${attempt.score.earned}/${attempt.score.possible}`;
    total.set(experimentId, `${cell.members[0]?.verdict ?? attempt.verdict ?? "?"}${score} ${locator}`);
    const entries: Entry[] = attempt.assertions?.entries ?? [];
    const details = await inBatches(entries, 8, async (entry) =>
      (await query(shell, { kind: "attempt.assertion.detail", locator, entryId: entry.entryId })).assertion.entry);
    entries.forEach((entry, index) => {
      const key = entry.display.key ?? entry.display.label ?? entry.entryId;
      const row = rows.get(key) ?? new Map<string, string>();
      rows.set(key, row);
      row.set(experimentId, reading(details[index]));
    });
  }
}

for (const [evalId, rows] of [...matrix].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n## ${evalId}\n`);
  console.log(`| 判据 | ${experimentIds.join(" | ")} |`);
  console.log(`| --- | ${experimentIds.map(() => "---").join(" | ")} |`);
  console.log(`| **总计** | ${experimentIds.map((id) => totals.get(evalId)?.get(id) ?? "—").join(" | ")} |`);
  for (const [key, row] of rows) {
    const readings = experimentIds.map((id) => row.get(id) ?? "—");
    // 各候选读数不全相同的行才有区分度，加粗标出。
    const differs = new Set(readings).size > 1;
    console.log(`| ${differs ? `**${key}**` : key} | ${readings.join(" | ")} |`);
  }
}
