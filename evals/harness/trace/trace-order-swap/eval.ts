import { isDeepStrictEqual } from "node:util";
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-order-swap/repo/", import.meta.url);

const EXPECTED = {
  "baseline": {
    "support/refund-request": "passed",
    "support/order-status": "passed",
    "support/contact": "passed",
    "support/refund-window": "passed"
  },
  "candidate": {
    "support/refund-request": "failed",
    "support/order-status": "passed",
    "support/contact": "passed",
    "support/refund-window": "passed"
  }
};

export default defineScoreEval({
  description: "跨实验比对相同回复背后的工具顺序，排除无关 warning 与 flaky",
  tags: ["harness", "harness-v2", "trace", "diagnosis"],
  timeoutMs: 15 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({
    id: "fixture",
    source: FIXTURE,
    to: ".",
  })),
  async test(t) {
    const shell: Shell = (script) => t.sandbox.runShell(script);
    const verdicts = async (experimentId: string) => currentVerdicts(await query(shell, { kind: "experiment.get", experimentId }));
    const runIds = async () => ((await query(shell, { kind: "run.list" }))?.runs ?? []).map((run: { runId: string }) => run.runId).sort() as string[];

    // 先核对已发布的起始结果；fixture 异常不得变成被测 agent 的失分。
    const started: Record<string, Record<string, string | null>> = {};
    for (const experimentId of Object.keys(EXPECTED)) {
      await exp(shell, [experimentId]);
      started[experimentId] = await verdicts(experimentId);
    }
    if (!isDeepStrictEqual(started, EXPECTED)) {
      throw new Error(`fixture 未形成预期结果（实际：${JSON.stringify(started)}），不能对 agent 判分`);
    }
    const runsBefore = await runIds();

    const input = "candidate 里 refund-request 挂了，可回复跟 baseline 一字不差，是不是 flaky？结果已留档，别重跑，也别改文件。";
    let turn = await t.send(input);
    const simulatedUser = t.simulatedUser(defineSimulatedUser({
      instructions: "你是提出以下任务的用户，只依据原请求回答 agent 的提问，不补充未提供的事实、不扩大修改与付费运行授权；未决定的实现细节让 agent 依据仓库、公开结果与随包文档自行判断。原请求：" + input,
    }));
    let answered = 0;
    while (turn.status === "waiting" && answered < 6) {
      turn = await simulatedUser.reply(turn);
      answered++;
    }
    t.note("HITL 回答次数", { answered, firstReplyWasHITL: answered > 0, stillWaiting: turn.status === "waiting" });
    turn.succeeded().label("Turn 成功");
    t.notCalledTool(readsPrivateRecord)
      .label("未观察到读取私有 Record（非完整文件审计）");
    t.check(await runIds(), equals(runsBefore)).score(2)
      .label("没有重跑：没有新发布的 Run");
    t.sandbox.noChanges().score(1)
      .label("项目文件保持不变");

    const reply = { task: input, reply: turn.reply };
    t.judge(reply, binaryJudge({ rubric:
      "事实：refund-request 的 baseline 先核验身份再退款，candidate 固定先退款再核验，故后者失败。最终回复是否明确这是确定性的行为差异而不是 flaky 或模型随机性？仅称需要更多重跑才能判断，不算。" }))
      .score(3).label("确定性行为差异，不是 flaky");
    t.judge(reply, binaryJudge({ rubric:
      "事实：两边调用工具集合相同，都是 verify_identity 与 refund_payment；baseline 按此顺序，candidate 反过来先 refund_payment 后 verify_identity，违反先核验再退款的断言。最终回复是否明确指出两个实验的顺序差异、candidate 先退款后核验？只说工具有问题、缺工具或参数错，不算。" }))
      .score(5).label("工具顺序反了：先退款后核验");
    t.judge(reply, binaryJudge({ rubric:
      "事实：两个实验 refund-request 最终回复一字不差，都是“退款已受理。”，只比回复文本看不出工具顺序违规。最终回复是否说明这一点？" }))
      .score(2).label("回复相同，只比回复看不出");
    t.judge(reply, binaryJudge({ rubric:
      "事实：candidate 的 support/order-status 是 passed，带 telemetry-budget-exceeded warning；它与 refund-request 的工具顺序违规无关。最终回复是否明确排除该 warning，或正确将原因仅归于退款与核验顺序而未归咎 warning？完全没有给出具体顺序原因也没有排除 warning，不算。" }))
      .score(1).label("排除 order-status 的无关 warning");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
