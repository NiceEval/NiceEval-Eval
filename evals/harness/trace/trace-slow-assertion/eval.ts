import { isDeepStrictEqual } from "node:util";
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-slow-assertion/repo/", import.meta.url);

const EXPECTED = {
  "local": {
    "docs/citations": "passed",
    "docs/contact": "passed",
    "docs/formats": "passed"
  }
};

export default defineScoreEval({
  description: "文档回复很快但整体慢，只读定位串行链接断言的耗时",
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

    const input = "docs/citations 每次要一分多钟，agent 两秒就答完了，时间去哪了？结果已留档，别重跑。";
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
      "事实：docs/citations 的 agent Turn 约 1 秒，不到 2 秒，额外约 100 秒在断言阶段，不是 agent、Sandbox 或 Judge。最终回复是否依据公开 timing 记录（或等价公开 query 耗时证据）定位到断言阶段，并排除上述误归因？仅凭源码猜测断言慢、没有公开耗时证据，不算。" }))
      .score(4).label("时间花在断言阶段");
    t.judge(reply, binaryJudge({ rubric:
      "事实：docs/citations 里耗时的是自定义检查“引用链接都可访问”，其余断言毫秒级。最终回复是否准确定位到这一条链接可访问性检查？允许结合项目自己的 Eval 源码与公开 timing 定位。泛称断言或评估太慢、不指出具体检查，不算。" }))
      .score(4).label("定位引用链接都可访问检查");
    t.judge(reply, binaryJudge({ rubric:
      "事实：链接可访问检查对 20 个链接逐个串行，每个等待约 5 秒，总计约 100 秒。最终回复是否准确说明串行机制及这组数量/耗时量级？串行机制、20 个链接和每个等待 5 秒可以依据项目自己的 Eval 源码解释，不要求公开 timing 提供单条断言耗时。说成并行、agent 搜索等待或缺少数量与每个耗时，不算。" }))
      .score(2).label("20 个串行链接，每个约 5 秒");
    t.judge(reply, binaryJudge({ rubric:
      "事实：agent 有一条很长的 search_docs 输出，但 Turn 不到 2 秒；耗时是后续链接检查。最终回复是否明确排除长输出为原因，或准确将耗时归于串行链接检查而未归咎长输出？只泛称总耗时而未定位串行检查，不算。" }))
      .score(1).label("排除长工具输出干扰");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
