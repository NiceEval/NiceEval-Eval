import { isDeepStrictEqual } from "node:util";
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { currentVerdicts, exp, query, type Shell } from "../../../lib/query.ts";
import { readsPrivateRecord } from "../private-record.ts";

const FIXTURE = new URL("../../../fixtures/harness/errored-triage/repo/", import.meta.url);

const EXPECTED = {
  "nightly/cite-sources": "failed",
  "nightly/export-pdf": "errored",
  "nightly/summarize": "failed",
  "nightly/translate": "passed",
  "nightly/web-search": "errored",
};

export default defineScoreEval({
  description: "只读归因：区分 nightly 的执行错误与合法失败，分别交给平台组和模型组",
  tags: ["harness", "harness-v2", "holdout", "diagnosis", "single-turn"],
  timeoutMs: 15 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({ id: "fixture", source: FIXTURE, to: "." })),
  async test(t) {
    const shell: Shell = (script) => t.sandbox.runShell(script);
    const runIds = async () => ((await query(shell, { kind: "run.list" }))?.runs ?? [])
      .map((run: { runId: string }) => run.runId).sort() as string[];
    await exp(shell, ["nightly"]);
    const started = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "nightly" }));
    if (!isDeepStrictEqual(started, EXPECTED)) {
      throw new Error(`fixture 初始 verdict 不符：${JSON.stringify(started)}，不能对 agent 判分`);
    }
    const runsBefore = await runIds();
    const input = "昨晚 nightly 挂了好几条。帮我分一下：哪些是助手本身的问题要交给模型组，哪些是跑测环境的问题要交给平台组，每条说说依据。只看，不要改，也不要重跑。";
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
    t.notCalledTool(readsPrivateRecord).label("未观察到读取私有 Record（非完整文件审计）");
    t.check(await runIds(), equals(runsBefore)).score(2).label("没有重跑：没有新发布的 Run");
    t.sandbox.noChanges().score(1).label("项目文件保持不变");
    const reply = { task: input, reply: turn.reply };
    t.judge(reply, binaryJudge({ rubric: "最终回复是否符合以下事实：模型组恰好是 nightly/summarize 和 nightly/cite-sources，平台组恰好是 nightly/web-search 和 nightly/export-pdf；nightly/translate 已通过，不算问题。漏项、分错组或把 translate 算问题均不算。" }))
      .score(4).label("分组恰好正确");
    t.judge(reply, binaryJudge({ rubric: "最终回复是否符合以下事实：指出 web-search 执行错误是跑测环境缺少 SEARCH_API_KEY，不是搜索答案错误。" }))
      .score(2).label("web-search：缺少 SEARCH_API_KEY");
    t.judge(reply, binaryJudge({ rubric: "最终回复是否符合以下事实：指出 export-pdf 的依赖服务 127.0.0.1:6379 连接被拒绝（ECONNREFUSED），应排查渲染服务未启动或不可达。" }))
      .score(2).label("export-pdf：本地 6379 连接被拒绝");
    t.judge(reply, binaryJudge({ rubric: "最终回复是否符合以下事实：指出 summarize 的合法失败是摘要漏了要求的营收数字 4.2M。只说断言失败不算。" }))
      .score(2).label("summarize：漏了营收数字 4.2M");
    t.judge(reply, binaryJudge({ rubric: "最终回复是否符合以下事实：指出 cite-sources 引用了 https://unlisted.example/report，超出允许的 https://reports.example/quarterly 来源列表。必须说明越过来源范围，不能只说引用错了。" }))
      .score(2).label("cite-sources：引用了来源列表之外的 URL");
    t.judge(reply, binaryJudge({ rubric: "最终回复是否符合以下事实：说明环境类的 errored 代表执行没有完成、未获得可信业务结论，不能据此判断助手答得对不对；与完成执行但断言失败的产品问题区分。" }))
      .score(1).label("说明 errored 不能判定助手答得对不对");
  },
});
