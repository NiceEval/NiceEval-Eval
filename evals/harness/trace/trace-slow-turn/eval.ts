import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-slow-turn/repo/", import.meta.url);

const EXPECTED = {
  "local": {
    "booking/breakfast": "passed",
    "booking/checkout-time": "passed",
    "booking/parking": "passed",
    "booking/three-step": "passed"
  }
};

export default defineScoreEval({
  description: "三轮订房全部通过却耗时一分多钟：只读定位时间与原因",
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

    const input = "booking/three-step 每次都要一分多钟，别的都是一秒，慢在哪？结果已留档，别重跑。";
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
      "事实：booking/three-step 的三轮中，第 1 轮与第 3 轮各约 2.5 秒，第 2 轮约 75 秒。最终回复是否明确定位主要耗时在第 2 个 Turn/第二轮（提供日期、搜索酒店的那轮）？只说整个评估慢，不算。" }))
      .score(4).label("慢在第 2 轮");
    t.judge(reply, binaryJudge({ rubric:
      "事实：第 2 轮 search_hotels 共调用 3 次，前两次返回 {\"error\":\"rate_limited\",\"retryAfterSeconds\":30}，第三次成功。最终回复是否指出搜索酒店工具被限流、失败后重试了两次才成功？只说调用工具慢、不说明限流重试，不算。" }))
      .score(4).label("search_hotels 被限流后重试两次");
    t.judge(reply, binaryJudge({ rubric:
      "事实：fixture 是直连 canned agent，不使用 Sandbox，也没有 Judge 调用；第 2 轮限流重试路径真实等待约 75 秒。最终回复是否说明主因是工具限流重试等待，并排除 Judge/断言评估、Sandbox 准备和模型推理为主要瓶颈？将上述任一项当作主因不算。" }))
      .score(2).label("排除 Judge、Sandbox 与模型推理为主因");
    t.judge(reply, binaryJudge({ rubric:
      "事实：第 2 轮约 75 秒，占三轮总计约 80 秒的绝大部分。最终回复是否给出这一量级（第二轮约 75 秒、总约 80 秒，或等价近似占比）？只说一分多钟而未量化第二轮占比或耗时，不算。" }))
      .score(2).label("给出约 75 / 80 秒的量级");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
