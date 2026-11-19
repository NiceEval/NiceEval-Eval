import { defineScoreEval } from "niceeval";
import { binaryJudge, equals } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { query, type Shell } from "../../../lib/query.ts";
import { readsPrivateRecord } from "../private-record.ts";

const fixture = new URL("../../../fixtures/harness/rerun-scope/repo/", import.meta.url);
const evalId = "support/refund";
const oldFile = "evals/support/refund.eval.ts";
// 这份客服项目很小。比较两轮之间的题目和说明，让 Judge 看实际改动。
const readMaterials = `set -eu
set -- evals
if [ -d docs ]; then set -- "$@" docs; fi
if [ -f README.md ]; then set -- "$@" README.md; fi
find "$@" -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.md' \\) -print0 |
  LC_ALL=C sort -z | xargs -0 -r -n 1 sh -ec 'echo "=== $1"; cat -- "$1"' sh`;

export default defineScoreEval({
  description: "先核实退款时效，再按用户的追问整理题目，保留刚才的结果",
  tags: ["harness", "harness-v2", "multi-turn", "reuse"],
  timeoutMs: 20 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({ id: "fixture", source: fixture, to: "." })),
  async test(t) {
    const shell: Shell = script => t.sandbox.runShell(script);
    const runList = async (): Promise<{ runId: string }[]> => {
      const doc = await query(shell, { kind: "run.list" });
      if (!Array.isArray(doc?.runs)) throw new Error("缺少公开 Run 列表");
      return doc.runs;
    };

    const source = await t.sandbox.readText(oldFile);
    const edited = source.replace('includes("within 7 days")', 'includes("5 business days")');
    if (source === edited || (await runList()).length !== 0) throw new Error("退款题需要原始判据和空的运行历史");
    await t.sandbox.writeText(oldFile, edited);

    const firstRequest = "退款现在要求客服说清楚是 5 个工作日。我刚改了退款时效这道题，帮我用 local 跑一下这题，看看客服答对了没有。";
    const first = await t.send(firstRequest);
    await first.succeeded().label(firstRequest).orStop();
    await t.check(await t.sandbox.pathExists(oldFile) && await t.sandbox.readText(oldFile) === edited, equals(true))
      .gate().label("第一轮按用户给定的判据核实结果").orStop();
    const before = await runList();
    const current = await query(shell, { kind: "experiment.get", experimentId: "local" });
    const members = current?.experiment.cells.find((cell: { evalId: string }) => cell.evalId === evalId)?.members ?? [];
    const attempt = members[0];
    const locator = attempt?.publication?.attemptLocator;
    const verdict = attempt?.verdict ?? attempt?.publication?.verdict;
    if (attempt?.publication && typeof locator !== "string") throw new Error("已发布的退款结果缺少 Attempt locator");
    await t.check(members.length === 1 && verdict === "failed" && typeof locator === "string", equals(true))
      .gate().score(3).label("第一轮真的跑出了退款题的 failed 结果").orStop();
    t.judge(first.reply, binaryJudge({ rubric: "是否明确说退款题没有通过，并指出客服答的是 7 天，用户的新要求是 5 个工作日？" }))
      .score(2).label("向用户说清退款题为什么失败");

    const originalMaterials = (await t.sandbox.runShellOrThrow(readMaterials)).stdout;
    const secondRequest = "好，帮我把刚才那道退款题整理一下吧。刚跑出来的结果留着用，不用再跑客服机器人了。";
    const second = await t.send(secondRequest);
    await second.succeeded().label(secondRequest).orStop();
    const organizedMaterials = (await t.sandbox.runShellOrThrow(readMaterials)).stdout;
    await t.check(originalMaterials !== organizedMaterials, equals(true))
      .gate().label("第二轮实际改动了题目或项目说明").orStop();
    await t.judge({ before: originalMaterials, after: organizedMaterials }, binaryJudge({
      rubric: "比较整理前后的文件。改动是否让退款题更容易找到、读懂或维护？移动、改名、在原文件理清说明、补上有用的索引都可以。仅改无关内容或只记下运行结果不得分。",
    })).gate(1).score(2).label("退款题得到实际整理").orStop();
    t.notCalledTool(readsPrivateRecord).label("未观察到访问私有结果路径");
    t.sandbox.unchangedWithin([
      "agents", "experiments", "niceeval.config.ts", "evals/support/cancel.eval.ts",
      "evals/support/order-status.eval.ts", "evals/support/password-reset.eval.ts", "evals/support/shipping.eval.ts",
    ]).gate().score(1).label("其余客服题、机器人和实验配置保持原样");

    const after = await runList();
    const newRuns = after.filter(run => !before.some(old => old.runId === run.runId));
    const actions: string[] = [];
    for (const { runId } of newRuns) {
      const doc = await query(shell, { kind: "run.get", runId });
      if (!Array.isArray(doc?.run.plannedAttempts)) throw new Error(`Run ${runId} 缺少 Attempt 列表`);
      for (const slot of doc.run.plannedAttempts) {
        if (typeof slot.publication?.action !== "string") throw new Error(`Run ${runId} 的发布证据不完整`);
        actions.push(slot.publication.action);
      }
    }
    t.check(before.every(old => after.some(run => run.runId === old.runId)) && actions.every(action => action === "carried"), equals(true))
      .gate().score(2).label("保留原 Run，整理期间没有新执行或显式采用结果");

    const dry = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["exp", "local", evalId, "--dry", "--json"]);
    await t.check(dry.exitCode, equals(0)).gate().label("整理后仍能按原 ID 预览退款题").orStop();
    const plan = JSON.parse(dry.stdout);
    const row = plan.matrix.find((pair: { experimentId: string; evalId: string }) => pair.experimentId === "local" && pair.evalId === evalId);
    const reused = row?.readbacks?.[0];
    if (plan.reused === 1 && row !== undefined && typeof reused?.source?.locator !== "string") {
      throw new Error("预览报告沿用，但没有提供来源 Attempt locator，无法核验");
    }
    t.check({ total: plan.total, reused: plan.reused, locator: reused?.source?.locator, verdict: reused?.verdict },
      equals({ total: 1, reused: 1, locator, verdict: "failed" }))
      .gate().score(4).label("预览沿用第一轮同一个 failed Attempt");
  },
});
