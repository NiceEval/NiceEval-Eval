/**
 * install 题共用的取证探针：只从被测 sandbox 取回事实，不登记任何检查。
 *
 * 判据（t.check / closeQA / judge）全部留在各题 eval.ts 正文里，读一道题就能看到它测什么、
 * 什么算通过；这里只放「一条命令或一个文件」的取证与归档。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScoreTestContext } from "niceeval";
import { publicQuery, runRefs, runResult, type Member, type RunCommand } from "./harness/public-results.ts";

type Sandbox = ScoreTestContext["sandbox"];

/** agent 自建的 NiceEval 项目根（含 niceeval.config.ts 的目录），未安装时为 null。 */
export async function locateInstallRoot(sandbox: Sandbox): Promise<string | null> {
  const hit = (
    await sandbox.runShell(
      "find . -maxdepth 3 -name niceeval.config.ts -not -path '*/node_modules/*' | head -1",
    )
  ).stdout.trim();
  if (!hit) return null;
  return hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
}

/** 用项目内安装的候选 CLI 执行，避免全局或 latest 版本混入证据。 */
export function runCandidateCli(sandbox: Sandbox, root: string, args: readonly string[]) {
  return sandbox.runCommand("./node_modules/.bin/niceeval", [...args], { cwd: root });
}

/** agent 写出的 config、Adapter、Experiment 与 Eval 源码，按文件拼成一份 Judge 材料。 */
export async function readAuthoredSource(sandbox: Sandbox, root: string): Promise<string> {
  const result = await sandbox.runShell(
    `for path in niceeval.config.ts evals experiments agents adapters; do
  if [ -f "$path" ]; then printf '\\n// @file %s\\n' "$path"; cat "$path"; fi
  if [ -d "$path" ]; then
    find "$path" -type f -name '*.ts' | sort | head -30 | while IFS= read -r file; do
      printf '\\n// @file %s\\n' "$file"; cat "$file"
    done
  fi
done`,
    { cwd: root },
  );
  return result.stdout.trim();
}

const ATTEMPT_LOCATOR = /(?<![A-Za-z0-9])@[0-9A-HJKMNP-TV-Z]{13}(?![A-Za-z0-9])/g;

/**
 * 交接里明确写出、且能在候选公开 query 中找到的最后一个 Attempt。
 * 不从「最新一条结果」猜本轮产物；交接没写 locator，或候选 CLI 解析不到，就是没有。
 * 仍在 active 或读不完整的 Run 跳过，不让 agent 留下的中断 Run 把外层 Attempt 变成 errored。
 */
export async function findHandoffAttempt(
  sandbox: Sandbox,
  root: string,
  handoff: string,
): Promise<(Member & { locator: string; experimentId: string }) | null> {
  const locators = (handoff.match(ATTEMPT_LOCATOR) ?? []).reverse();
  if (locators.length === 0) return null;
  const runCommand: RunCommand = (cmd, args) => sandbox.runCommand(cmd, args, { cwd: root });
  const refs = await publicQuery(runCommand, { kind: "runs.list" }).then(runRefs, () => []);
  const runs = [];
  for (const { runId } of refs) {
    const run = await publicQuery(runCommand, { kind: "run.summary", runId })
      .then((doc) => runResult(doc, runId), () => null);
    if (run !== null) runs.push(run);
  }
  for (const locator of locators) {
    for (const run of runs) {
      const member = run.members.find((m) => m.locator === locator);
      if (member) return { ...member, locator, experimentId: run.experimentId };
    }
  }
  return null;
}

const AGENT_OUTPUT_ROOT = resolve(import.meta.dirname, "../.agent-output");

/** 把 agent 产出下载到 .agent-output/ 供人工复审；失败只记日志，不影响评分。 */
export async function archiveAgentOutput(t: ScoreTestContext, target: string): Promise<void> {
  try {
    const root = await locateInstallRoot(t.sandbox);
    if (root === null) return;
    const prefix = root === "." ? "" : `${root}/`;
    const version = safeSlug(String(t.flags.candidateVersion ?? "unknown"));
    const model = safeSlug(t.model ?? "model");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolve(AGENT_OUTPUT_ROOT, version, safeSlug(target), `${stamp}__${model}`);
    mkdirSync(out, { recursive: true });

    let got = false;
    for (const dir of ["evals", "experiments", "agents", "adapters"]) {
      await t.sandbox.downloadDirectory(`${prefix}${dir}`, resolve(out, dir))
        .then(() => { got = true; })
        .catch(() => {});
    }
    await t.sandbox.downloadFile(`${prefix}niceeval.config.ts`, resolve(out, "niceeval.config.ts"))
      .then(() => { got = true; })
      .catch(() => {});
    if (!got) {
      rmSync(out, { recursive: true, force: true });
      return;
    }
    writeFileSync(resolve(out, "_meta.txt"), `target=${target}\ncandidateVersion=${version}\nmodel=${model}\n`);
    t.log(`agent 产出已归档到 ${out}`);
  } catch (error) {
    t.log(`归档 agent 产出失败（已忽略）：${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeSlug(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}
