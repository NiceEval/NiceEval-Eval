import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { exp, query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/trace-flaky-cause/repo/", import.meta.url);

const EXPECTED = {
  "local": {
    "weather/umbrella": [
      "failed",
      "failed",
      "passed",
      "passed"
    ],
    "weather/temperature": [
      "passed",
      "passed",
      "passed",
      "passed"
    ],
    "weather/wind": [
      "passed",
      "passed",
      "passed",
      "passed"
    ]
  }
};

export default defineScoreEval({
  description: "同一 Run 四次天气采样，只读比对旧缓存与失败对应关系",
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
    const verdicts = async (experimentId: string) => {
      const doc = await query(shell, { kind: "experiment.get", experimentId });
      return Object.fromEntries(doc.experiment.cells.map((cell: {
        evalId: string;
        members: { verdict?: string | null; publication?: { verdict?: string } }[];
      }) => [cell.evalId, cell.members.map((member) => member.verdict ?? member.publication?.verdict ?? null).sort()]));
    };
    const runIds = async () => ((await query(shell, { kind: "run.list" }))?.runs ?? []).map((run: { runId: string }) => run.runId).sort() as string[];

    // 先核对已发布的起始结果；fixture 异常不得变成被测 agent 的失分。
    const started: Record<string, Record<string, (string | null)[]>> = {};
    for (const experimentId of Object.keys(EXPECTED)) {
      await exp(shell, [experimentId]);
      started[experimentId] = await verdicts(experimentId);
    }
    if (!isDeepStrictEqual(started, EXPECTED)) {
      throw new Error(`fixture 未形成预期结果（实际：${JSON.stringify(started)}），不能对 agent 判分`);
    }
    const runsBefore = await runIds();

    const input = "weather/umbrella 有时过有时不过，是模型随机性还是有确定原因？要不要加重试？结果已留档，别重跑。";
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
      "事实：weather/umbrella 四次采样两过两败，失败严格对应旧缓存工具输出，并不是模型随机性。最终回复是否判断存在确定原因，而不是随机生成、偶发超时或仅说样本不足？" }))
      .score(3).label("失败有确定原因，不是模型随机");
    t.judge(reply, binaryJudge({ rubric:
      "事实：第 2、4 次 get_forecast 返回 cached:true、ageSeconds:7200、rainChance:0.1，两次失败；第 1、3 次返回 cached:false、rainChance:0.8，两次通过。最终回复是否指出两次失败都来自两小时前的缓存数据，并准确对应通过与失败样本？只说缓存可能有问题而未指出两小时旧数据及对应关系，不算。" }))
      .score(5).label("失败两次拿到两小时前缓存");
    t.judge(reply, binaryJudge({ rubric:
      "事实：失败的两次工具拿到旧缓存低降雨概率，故回复不用带伞；通过两次新鲜数据高降雨概率，回复记得带伞。失败额外慢约 1.5 秒，但没有超时。最终回复是否把决定性差异定位在工具输出而不是回复风格或耗时？" }))
      .score(2).label("差别在工具输出，不在风格或耗时");
    t.judge(reply, binaryJudge({ rubric:
      "事实：确定原因是过期缓存的数据，不是模型随机性。最终回复是否建议修复或排查数据源/缓存新鲜度，而不是加重试来掩盖问题？只建议多跑到通过，不算。" }))
      .score(1).label("修数据源或缓存，不靠重试");
    t.judge(reply, binaryJudge({ rubric:
      "事实：本题证据已通过 NiceEval 公开 show / query 留档。最终回复是否提供与诊断相关、可复查的具体 Attempt locator（@...），或指向相应实验/Attempt/执行轮次的公开 niceeval show / query 命令？仅说“看了日志/trace/结果”、给出通用 show 而不能定位相关证据，或引用私有 .niceeval 文件，不算。" }))
      .score(2).label("引用可复查的公开证据");
  },
});
