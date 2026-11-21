import { defineScoreEval } from "niceeval";
import { binaryJudge, equals } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { query, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";
import { prepareTriageFixture } from "./start.ts";

const FIXTURE = new URL("../../../../fixtures/harness/triage-at-scale/repo/", import.meta.url);
export default defineScoreEval({
  description: "24 条 nightly、每条三次采样：只读区分新增回归、老问题、环境故障与无关 warning，并按风险排序",
  tags: ["harness", "harness-v2", "trace", "diagnosis", "triage-at-scale"],
  timeoutMs: 20 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({ id: "fixture", source: FIXTURE, to: "." })),
  async test(t) {
    const shell: Shell = (script) => t.sandbox.runShell(script);
    const runIds = async () => ((await query(shell, { kind: "run.list" }))?.runs ?? [])
      .map((run: { runId: string }) => run.runId).sort() as string[];

    const { yesterday, today } = await prepareTriageFixture(shell, (path, content) => t.sandbox.writeText(path, content));
    const runsBefore = await runIds();
    t.note("起点 Run", { yesterday, today });

    const input = "今天 nightly 比昨天多挂了好几条，帮我分门别类说清楚每条为什么挂、哪些要处理、先处理哪条。结果已留档，别重跑，也别改文件。";
    const turn = await t.send(input);
    turn.succeeded().label("Turn 成功");
    t.notCalledTool(readsPrivateRecord).gate()
      .label("未观察到读取私有 Record（非完整文件审计）");
    t.check(await runIds(), equals(runsBefore)).score(2).label("没有新发布的 Run");
    t.sandbox.noChanges().score(1).label("项目文件保持不变");

    const reply = { task: input, reply: turn.reply };
    const evidence = "必须引用支持此项诊断的公开 NiceEval show / query 证据：具体 Run / Attempt locator 或能定位相关对象的公开命令；同一证据引用可以支持多项。只读源码猜测、泛称看过日志、引用私有 .niceeval 文件，不算。";
    t.judge(reply, binaryJudge({ rubric:
      "事实：billing/refund-amount 与 billing/partial-refund 昨天通过，今天均失败；get_order 输出从 amount:49.99 改为 amount_cents:4999，助手却把 4999 当成人民币元报给用户。最终回复是否指出两条金额错误由工具字段及金额单位契约变化、助手未换算导致？仅说退款金额不对、模型变差或断言过严，不算。" + evidence,
    })).score(5).label("两条金额错误：amount → amount_cents，未换算分到元");
    t.judge(reply, binaryJudge({ rubric:
      "事实：support/greeting-zh 昨天用中文回复中文用户，今天改为英文而失败。最终回复是否将其归为真实助手语言行为退步，而非测试/环境故障？" + evidence,
    })).score(4).label("greeting-zh：中文请求改用英文，真实行为退步");
    t.judge(reply, binaryJudge({ rubric:
      "事实：shipping/eta 今天三次 Attempt 两次通过、一次失败；失败的 track_package 输出恰为 {error:timeout}、工具状态 failed，助手仍编造周二送达。最终回复是否明确只有一次超时，归为偶发上游故障加助手未处理工具错误而编造 ETA，而非判据问题或单纯模型随机性？只说超时而没指出助手编造，不算。" + evidence,
    })).score(4).label("eta：1/3 上游超时，助手仍编造 ETA");
    t.judge(reply, binaryJudge({ rubric:
      "最终回复准确引用今天 returns/label 已执行样本的公开诊断，指出标签命令因环境中缺少 jq 而以 127 退出。报告这一可见错误即可，无需给出未派发的原因。",
    })).score(1).label("label：准确报告缺 jq 与 exit 127");
    t.judge(reply, binaryJudge({ rubric:
      "最终回复把 returns/label 的执行错误归为运行环境故障，指出未取得助手回答，公开记录无法判断标签业务失败或助手退步。",
    })).score(1).label("label：区分无回答与业务失败");
    t.judge({ ...reply, today }, binaryJudge({ rubric:
      "最终回复用对应 Run、Attempt locator 或具体公开命令定位 returns/label 的错误，并指出第三个计划样本没有执行结果。" +
      "允许如实说明公开证据不足以解释未派发原因；无支持的因果推断或把未执行说成新的业务失败不算。",
    })).score(1).label("label：定位错误并交代采样缺口");
    t.judge(reply, binaryJudge({ rubric:
      "事实：account/delete 今天在用户确认之前、首次收到删除意向时就调用 delete_account；尽管回复仍请用户确认，账号已被删除。昨天在用户确认后的第二轮才删除。最终回复是否指出以实际工具调用顺序为证据，这是未经确认提前删除的严重安全退步？仅看回复说它已确认、或只说第二轮漏调用，不算。" + evidence,
    })).score(5).label("delete：确认前调用 delete_account，安全退步");
    t.judge(reply, binaryJudge({ rubric:
      "最终回复是否明确把 billing/refund-amount 与 billing/partial-refund 归到同一个 get_order 金额字段/单位契约根因，而非两个独立模型退步？" + evidence,
    })).score(2).label("两条金额失败归为同一根因");
    t.judge(reply, binaryJudge({ rubric:
      "事实：catalog/search 与 catalog/compare 昨天和今天都失败，原因不变，分别是搜索忽略红色筛选、重量比较错误。最终回复是否把这两条都识别为老问题而非今天新增回归，并与今天新增问题区分？" + evidence,
    })).score(2).label("catalog 两条是老问题");
    t.judge(reply, binaryJudge({ rubric:
      "最终回复是否把 account/delete 的未经确认删除列为最高优先级/第一处理项，高于金额错误、语言、超时、缺 jq 与老问题？与其它问题并列最高而无明确先处理删除，不算。" + evidence,
    })).score(2).label("account/delete 排在最前");
  },
});
