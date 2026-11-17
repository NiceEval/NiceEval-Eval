import { isDeepStrictEqual } from "node:util";
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-token-spike/repo/", import.meta.url);

const EXPECTED = {
  "baseline": {
    "kb/account": "passed",
    "kb/delivery": "passed",
    "kb/troubleshooting": "passed",
    "general/greeting": "passed",
    "general/language": "passed",
    "general/contact": "passed"
  },
  "candidate": {
    "kb/account": "passed",
    "kb/delivery": "passed",
    "kb/troubleshooting": "passed",
    "general/greeting": "passed",
    "general/language": "passed",
    "general/contact": "passed"
  }
};

export default defineScoreEval({
  description: "提示词更换后 verdict 相同而费用暴涨：只读定位用量与检索参数变化",
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

    const input = "换了新提示词以后结果都一样，但账单涨了好几倍，钱花在哪了？结果已留档，别重跑。";
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
      "事实：candidate 相比 baseline，只有 kb/account、kb/delivery、kb/troubleshooting 三条知识检索评估输入 token 大涨，general/greeting、general/language、general/contact 不变。最终回复是否准确指出用量涨幅集中在 3 条 kb/*，其它三条基本不变？说全部六条都涨、漏掉知识检索范围，不算。" }))
      .score(4).label("涨幅集中在 3 条 kb/*");
    t.judge(reply, binaryJudge({ rubric:
      "事实：baseline 的 search_kb 参数 topK 是数值 3；candidate 改成字符串 all，输出包含整个知识库的几十 KB 文本，导致输入上下文膨胀。最终回复是否指出 topK 从 3 改为 all、把整个知识库塞进上下文这一机制？泛称提示词变长、模型变贵或检索变多，不算。" }))
      .score(4).label("topK 改为 all，整个知识库进入上下文");
    t.judge(reply, binaryJudge({ rubric:
      "事实：三条 kb/* 每条 Turn 的 inputTokens 从 baseline 约 2000 涨到 candidate 约 50000，输出 token 不变。最终回复是否给出约 2k 到 50k 的输入 token 量级（或明确同一输入口径约 25 倍）？误说成输出 token、只说总账单变贵，不算。" }))
      .score(3).label("输入 token 约 2k → 50k");
    t.judge(reply, binaryJudge({ rubric:
      "事实：两个实验相同六条评估全部 passed，verdict 完全相同。最终回复是否说明用量变化没有改善 verdict、两边结果相同且都通过？称 candidate 新增失败或通过率改善，不算。" }))
      .score(1).label("verdict 未变，两边全通过");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
