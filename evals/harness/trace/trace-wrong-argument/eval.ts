import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-wrong-argument/repo/", import.meta.url);

const EXPECTED = {
  "local": {
    "support/cancel-order": "failed",
    "support/gift-wrapping": "passed",
    "support/password-reset": "passed"
  }
};

export default defineScoreEval({
  description: "回复说取消了指定订单：只读判断实际业务操作与判据责任",
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

    const input = "cancel-order 这条挂了，可助手回复明明说取消了 A-1002，是不是判据写错了？结果已留档，别重跑，也别改文件。";
    const turn = await t.send(input);
    turn.succeeded().label("Turn 成功");
    t.notCalledTool(readsPrivateRecord)
      .label("未观察到读取私有 Record（非完整文件审计）");
    t.check(await runIds(), equals(runsBefore)).score(2)
      .label("没有重跑：没有新发布的 Run");
    t.sandbox.noChanges().score(1)
      .label("项目文件保持不变");

    const reply = { task: input, reply: turn.reply };
    t.judge(reply, binaryJudge({ rubric:
      "事实：用户指定取消 A-1002，判据要求 cancel_order 参数为 A-1002；助手实际取消了 A-1001，最终却说取消 A-1002。最终回复是否明确判断判据没错、错误在助手取消了错误订单？仅说断言失败、怀疑判据过严或认可最终回复，不算。" }))
      .score(4).label("判据没错，助手取消错了订单");
    t.judge(reply, binaryJudge({ rubric:
      "事实：cancel_order 的实际输入是 {\"orderId\":\"A-1001\"}，返回的取消订单也是 A-1001。最终回复是否指出实际取消的是 A-1001？只复述用户要求或助手最终回复里的 A-1002，不算。" }))
      .score(3).label("实际取消 A-1001");
    t.judge(reply, binaryJudge({ rubric:
      "最终回复准确说明 lookup_orders 依次返回 A-1001 和 A-1002。" }))
      .score(1).label("读出两条查询结果及顺序");
    t.judge(reply, binaryJudge({ rubric:
      "最终回复将实际取消的订单与查询结果联系起来：取消了列表第一条 A-1001，用户指定的是 A-1002。描述可观察的选择即可，不要求断言助手内部如何挑选订单。" }))
      .score(2).label("实际取消查询结果第一条");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
