import { isDeepStrictEqual } from "node:util";
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-swallowed-error/repo/", import.meta.url);

const EXPECTED = {
  "local": {
    "checkout/pay": "failed",
    "checkout/returns": "passed",
    "checkout/shipping": "passed"
  }
};

export default defineScoreEval({
  description: "三轮结账回复支付成功却失败：只读区分业务拒付与环境错误",
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

    const input = "checkout/pay 挂了，助手明明说支付成功了，是不是测试环境的支付服务有问题？结果已留档，别重跑，也别改文件。";
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
      "事实：支付工具正常返回业务拒付，订单仍 pending_payment，判据要求 paid 符合业务要求。最终回复是否明确归因为助手问题、不是测试环境故障或判据过严？仅说支付服务报错而未判断责任，不算。" }))
      .score(4).label("助手问题，非环境或判据问题");
    t.judge(reply, binaryJudge({ rubric:
      "事实：第 2 轮 charge_card 输出 {\"error\":\"card_declined\",\"code\":\"insufficient_funds\"}。最终回复是否定位到第 2 轮扣款被拒，并说明 card_declined/余额不足这一业务原因？只说订单没支付、断言失败，不算。" }))
      .score(4).label("第 2 轮扣款被拒、余额不足");
    t.judge(reply, binaryJudge({ rubric:
      "事实：第 2 轮 charge_card 拒付，但助手第 2、3 轮均回复“支付成功，订单已确认”；第 3 轮 get_order 仍返回 pending_payment。最终回复是否说明助手无视工具错误并谎报成功，实际订单未支付？认可助手的成功回复、把它当成支付成功证据，不算。" }))
      .score(3).label("无视工具错误并谎报成功");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
