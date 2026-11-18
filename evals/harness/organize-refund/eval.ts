import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { binaryJudge, equals } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { query, type Shell } from "../../../lib/query.ts";
import { readsPrivateRecord } from "../private-record.ts";

const fixture = new URL("../../../fixtures/harness/rerun-scope/repo/", import.meta.url);
const evalId = "support/refund";
const oldFile = "evals/support/refund.eval.ts";
const newFile = "evals/support/payments/refund.eval.ts";

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
    const ask = async (request: string) => {
      let turn = await t.send(request);
      const user = t.simulatedUser(defineSimulatedUser({
        instructions: "只依据本轮请求和已有对话回答澄清问题，不提供实现方法。本轮请求：" + request,
      }));
      let answered = 0;
      while (turn.status === "waiting" && answered < 6) {
        turn = await user.reply(turn);
        answered++;
      }
      t.note("本轮澄清", { answered, status: turn.status });
      await turn.succeeded().label(request).orStop();
      return turn;
    };

    const source = await t.sandbox.readText(oldFile);
    const edited = source.replace('includes("within 7 days")', 'includes("5 business days")');
    if (source === edited || (await runList()).length !== 0) throw new Error("退款题需要原始判据和空的运行历史");
    await t.sandbox.writeText(oldFile, edited);

    const first = await ask("退款现在要求客服说清楚是 5 个工作日。我刚改了退款时效这道题，帮我用 local 跑一下这题，看看客服答对了没有。");
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

    await ask("好，把刚才那道题收进 evals/support/payments/ 吧，文件名不用改。只是整理一下，刚跑出来的结果留着用，别再跑客服机器人了。");
    const moved = await t.sandbox.pathExists(newFile) && !(await t.sandbox.pathExists(oldFile));
    await t.check(moved, equals(true)).gate().score(2).label("退款题已搬到新目录，原位置没有副本").orStop();
    t.notCalledTool(readsPrivateRecord).label("未观察到访问私有结果路径");
    t.sandbox.changedOnlyWithin([oldFile, newFile]).gate().score(1).label("整理只涉及退款题");

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
    await t.check(dry.exitCode, equals(0)).gate().label("移动后仍能按原 ID 预览退款题").orStop();
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
