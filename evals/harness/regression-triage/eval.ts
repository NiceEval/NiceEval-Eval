import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../lib/query.ts";
import { readsPrivateRecord } from "../private-record.ts";

const FIXTURE = new URL("../../../fixtures/harness/regression-triage/repo/", import.meta.url);

// 换模型前后同一批六条评估的已知结果。
const BASELINE = {
  "support/change-address": "failed",
  "support/duplicate-charge": "failed",
  "support/gift-wrapping": "passed",
  "support/order-status": "passed",
  "support/password-reset": "passed",
  "support/refund-policy": "passed",
};
const CANDIDATE = {
  ...BASELINE,
  "support/duplicate-charge": "passed",
  "support/order-status": "failed",
  "support/refund-policy": "failed",
};

export default defineScoreEval({
  description: "换模型前后两个实验都跑完了：说清哪里退步、为什么、哪里变好、哪条本来就挂",
  tags: ["harness", "harness-v2", "comparison", "diagnosis", "single-turn"],
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

    // 起点：两个实验各跑完一次，agent 接手已经停稳的 Record。
    await exp(shell, ["baseline"]);
    await exp(shell, ["candidate"]);
    const started = { baseline: await verdicts("baseline"), candidate: await verdicts("candidate") };
    if (!isDeepStrictEqual(started, { baseline: BASELINE, candidate: CANDIDATE })) {
      throw new Error(`fixture 未形成预期的两组结果（实际：${JSON.stringify(started)}），不能对 agent 判分`);
    }
    const runsBefore = await runIds();

    // 用户只问结论。不提示有几条退步、有没有变好的、有没有本来就挂的，也不提示该看回复还是看过程。
    const input = "我们打算把客服助手的模型从 atlas-1 换成 atlas-2，baseline 和 candidate 两个实验都跑完了。" +
      "帮我看看换完之后哪里退步了、为什么，值不值得换。结果已经留档，不要重跑。";
    const turn = await t.send(input);
    turn.succeeded().label("Turn 成功");
    turn.notCalledTool(readsPrivateRecord)
      .label("未观察到读取私有 Record（非完整文件审计）");
    t.check(await runIds(), equals(runsBefore)).score(2)
      .label("没有重跑：没有新发布的 Run");
    t.sandbox.noChanges().score(1)
      .label("项目文件保持不变");

    const reply = { task: input, reply: turn.reply };
    t.judge(reply, binaryJudge({ rubric:
          "事实：换成 atlas-2 之后，从通过变成失败的评估恰好是 support/refund-policy 与 support/order-status 两条。" +
      "最终回复列为退步的评估是否恰好是这两条？漏掉其中一条、把 support/change-address（两个模型都失败）或其它评估也算作这次换模型造成的退步，不算。" }))
      .score(4).label("退步的恰好是 refund-policy 与 order-status");
    t.judge(reply, binaryJudge({ rubric:
          "事实：atlas-2 对退款政策的回答不再给出 30 天退货期限，其余内容还在。最终回复是否把 refund-policy 的失败原因说成回答里缺了 30 天期限？" +
      "只说“断言失败”或“回复不符合预期”而没有指出缺的是期限，不算。" }))
      .score(2).label("refund-policy：回答丢了 30 天期限");
    // 两个模型给出的回复一字不差，差别只在 atlas-2 没有调用 lookup_order。只比回复文本看不出这条。
    t.judge(reply, binaryJudge({ rubric:
          "事实：atlas-2 对订单状态的最终回复与 atlas-1 完全相同，失败原因是它没有调用 lookup_order 查询订单系统就直接作答。" +
      "最终回复是否指出 order-status 的失败在于没有查询订单系统（没有调用 lookup_order / 没有工具调用）？" +
      "把原因说成回复内容有误、承运商或到货时间不对，不算。" }))
      .score(3).label("order-status：没有查订单系统就回答");
    t.judge(reply, binaryJudge({ rubric:
          "事实：support/duplicate-charge 在 atlas-1 下失败、在 atlas-2 下通过，因为 atlas-2 为重复扣款建了工单。" +
      "最终回复是否指出 duplicate-charge 在换模型后变好了（由失败变为通过）？没有提到这条改进，不算。" }))
      .score(2).label("指出 duplicate-charge 变好了");
    t.judge(reply, binaryJudge({ rubric:
          "事实：support/change-address 在两个模型下都失败，回答都没有说明只能在发货前修改地址。" +
      "最终回复是否把 change-address 说成换模型之前就存在、两个模型都失败的问题（而不是这次的退步，也不是没有问题）？完全没提这条，不算。" }))
      .score(2).label("change-address 是原本就有的失败");
    t.judge(reply, binaryJudge({ rubric:
          "事实：换成 atlas-2 有两条退步、一条改进、一条原有失败不变。最终回复是否给出了明确的建议（换、不换，或满足什么条件后再换），" +
      "并且这个建议以上述退步与改进为依据？只罗列结果不下结论，或声称 atlas-2 全面更好 / 没有退步，不算。" }))
      .score(1).label("给出有依据的结论");
  },
});
