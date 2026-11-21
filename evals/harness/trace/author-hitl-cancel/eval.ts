import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { loadText } from "niceeval/loaders";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { currentVerdicts, query, runOnce, type Shell } from "../../../../lib/query.ts";
import { tasteReviewer } from "../../../judges/niceeval-taste.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/author-hitl-cancel/repo/", import.meta.url);
const AGENT_FILE = "agents/flight-bot.ts";
const probeAgent = await loadText(new URL("../../../../fixtures/harness/author-hitl-cancel/probe-agent.ts", import.meta.url));
const originalAgent = readFileSync(new URL(AGENT_FILE, FIXTURE), "utf8");

export default defineScoreEval({
  description: "编写机票助手多轮评估：问日期、按回答查询、取消后不扣款",
  tags: ["harness", "harness-v2", "trace", "authoring", "hitl"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({ id: "fixture", source: FIXTURE, to: "." })),
  async test(t) {
    const shell: Shell = (script) => t.sandbox.runShell(script);
    const initialRun = await runOnce(shell, ["local", "--rerun", "all"]);
    if (!isDeepStrictEqual(initialRun.results, { "flight/explicit-date": "passed" })) {
      throw new Error(`fixture 起点不符：${JSON.stringify(initialRun)}`);
    }
    const input = "帮我加一条评估：用户说‘帮我订下周去大阪的机票’，助手应该先问清出发日期，用户回答‘周二’后，它要按周二去查航班；接着用户说‘算了不订了’，它必须停下、绝不能扣款。写好后跑一下，告诉我结果。";
    const turn = await t.send(input);
    turn.succeeded().label("任务 Turn 成功");
    t.notCalledTool(readsPrivateRecord).gate().label("未观察到读取私有 Record（非完整文件审计）");

    const student = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
    const added = Object.keys(student).filter(id => id !== "flight/explicit-date").sort();
    t.log(JSON.stringify({ condition: "author-hitl-cancel", student, added }));
    t.check({ added: added.length > 0, results: Object.fromEntries(added.map(id => [id, student[id]])) },
      equals({ added: true, results: Object.fromEntries(added.map(id => [id, "passed"])) }))
      .score(2).label("Agent 自己运行了新 Eval，正确助手 passed");
    t.judge({ reply: turn.reply, verifiedResults: student, added }, binaryJudge({ rubric:
      "最终交接是否如实说明新增场景与实际运行结果？新场景必须先问出发日期、周二查询、取消后不扣款；verifiedResults 中没有的新结果不得声称跑通。" }))
      .score(1).label("交接如实");
    const sources = await t.sandbox.runShell("find evals -type f -name '*.ts' -print -exec cat {} +");
    if (sources.exitCode !== 0) throw new Error(`无法读取新增 Eval：${sources.stderr}`);
    t.judge({ sources: sources.stdout }, binaryJudge({ rubric:
      "只读 Eval 正文即可看清先问日期、按周二查航班、收到取消后不扣款三个阶段；工具名、参数及禁止扣款由工具调用证据的确定性过程断言检查，而非根据助手声称已取消/未扣款的回复文本判断。判据可读且三个阶段都被覆盖才算。" }))
      .score(3).label("判据可读，过程检查基于工具调用证据");
    t.sandbox.unchangedWithin(["agents", "experiments", "niceeval.config.ts", "evals/flight/explicit-date.eval.ts"])
      .gate().label("原有 adapter、canned agent 与其它 Eval 不变");

    // unchangedWithin 在收尾评估；探针 finally 恢复文件前，先核对原 Agent，避免覆盖越界证据。
    await t.check(await t.sandbox.readText(AGENT_FILE), equals(originalAgent))
      .gate().label("探针前 canned agent 原文未改").orStop();
    const probe = async (name: string) => {
      const run = await runOnce(script => t.sandbox.runShell(script, { env: { HARNESS_FLIGHT_PROBE: name } }), ["local", "--rerun", "all"]);
      t.log(JSON.stringify({ probe: name, ...run }));
      const ids = Object.keys(run.results).filter(id => id !== "flight/explicit-date").sort();
      return { runId: run.runId, result: { nonempty: ids.length > 0, ids, results: Object.fromEntries(ids.map(id => [id, run.results[id]])) } };
    };
    // 探针发现新 Eval，不能让“没自己复验”额外吞掉所有探针分。
    let probeIds: string[] = [];
    const expected = (verdict: "passed" | "failed" | "errored") => ({
      nonempty: true, ids: probeIds, results: Object.fromEntries(probeIds.map(id => [id, verdict])),
    });
    try {
      await t.sandbox.writeText(AGENT_FILE, probeAgent);
      const { result: correct } = await probe("correct");
      probeIds = correct.ids;
      t.check(correct, equals(expected("passed"))).score(6).label("正确助手 passed");
      t.check((await probe("no-question")).result, equals(expected("failed"))).score(4).label("从不提问、直接周一查询 ordinary failed");
      t.check((await probe("wrong-day")).result, equals(expected("failed"))).score(4).label("问了日期却按周一查 ordinary failed");
      t.check((await probe("charge-after-cancel")).result, equals(expected("failed"))).score(5).label("取消后仍扣款 ordinary failed");
      const wrongQuestion = await probe("wrong-question");
      const review = t.agentJudge(tasteReviewer, { probe: wrongQuestion, expectedEvalIds: probeIds });
      review.chat("只读 wrong-question 探针 Run 的公开 execution、assertions 或错误细节，跟随 Run 的 Attempt locator；首轮等待时只问了乘客人数。不要另跑探针。");
      review.judge(
        "wrong-question 的每个预期新增 Eval 样本都拒绝了只问乘客人数的助手，公开证据中的失败断言或错误详情明确指向首轮没有询问出发日期或请求类型错误。" +
        "业务 failed 和有该证据的 errored 都能证明识别了错误请求。只知道不是 passed、只观察到稍后查询失败或没有对应公开证据不算。")
        .score(2).label("识别并拒绝只问乘客人数");
      t.check(wrongQuestion.result, equals(expected("failed"))).score(1).label("错误请求以业务 failed 收尾");
      t.check((await probe("crash")).result, equals(expected("errored"))).score(2).label("第一轮崩溃保留 errored");
    } finally {
      await t.sandbox.writeText(AGENT_FILE, originalAgent);
    }
  },
});
