/** roadmap 预览题的通用澄清：正式 install 题已经收进 evals/install/eval.ts。 */

import type { ScoreTestContext } from "niceeval";
import { equals, isTrue } from "niceeval/expect";
import { buildClarifyRubrics, type ClarifyFacts } from "./criteria/clarification.ts";

type Turn = Awaited<ReturnType<ScoreTestContext["send"]>>;

export interface IntegrationConversationOptions {
  clarify: ClarifyFacts;
  turn: Turn;
}

/** 计分通用接入澄清，并以原有 Tier 1 答复继续同一会话。 */
export async function scoreIntegrationConversation(
  t: ScoreTestContext,
  opts: IntegrationConversationOptions,
): Promise<void> {
  await t.group("评估交互", async () => {
    t.check(opts.turn.status === "waiting", isTrue("首轮等待澄清"))
      .score(1)
      .key("install.interaction.waited-for-clarification")
      .label("首轮等待澄清");
    for (const [index, rubric] of buildClarifyRubrics(opts.clarify).entries()) {
      opts.turn.judge.autoevals.closedQA(`【${rubric.key}】${rubric.criteria}`)
        .score(1)
        .key(`install.interaction.clarification.${index + 1}`)
        .label(rubric.key);
    }
  });

  // 只回答用户才有权决定的接入级别；用例、断言和实验设计继续由候选文档指导。
  const answer =
    "做简单的 Tier 1 接入，使用你刚才确认的接口；先不接 OTel，也不做 experiment flags。" +
    "没有可用 Judge key 时，按文档选择不依赖 Judge 的验证方式。" +
    "请继续完成接入，其余实现细节根据仓库和随包文档决定。";
  const pendingInputs = opts.turn.events.flatMap((event) =>
    event.type === "input.requested" ? [event.request] : []
  );
  // regression: Codex 可能在同一轮并列提出多个 request_user_input 问题；多个请求不能靠字符串
  // 顺序消歧，因此把这份覆盖全部决策的用户答复按稳定 request id 逐项对位。
  if (opts.turn.status === "waiting") {
    await t.respond(...pendingInputs.map((request) => ({ request, text: answer })));
  } else {
    await t.send(answer);
  }
}

export interface SandboxClarificationRubric {
  key: string;
  criteria: string;
}

/** 计分 sandbox 路径特有的首轮澄清；答复在下一阶段继续发送。 */
export async function scoreSandboxClarification(
  t: ScoreTestContext,
  turn: Turn,
  rubrics: readonly SandboxClarificationRubric[],
): Promise<boolean> {
  const clarifyReply = t.reply;
  const isWaiting = turn.status === "waiting";
  await t.group("评估交互", async () => {
    t.check(isWaiting, equals(true)).label("停下来澄清").score(1);
    for (const rubric of rubrics) {
      t.judge.autoevals.closedQA(`【${rubric.key}】${rubric.criteria}`, {
        input: "下面是 agent 在动手前给出的澄清回复。",
        output: clarifyReply,
      }).score(1);
    }
  });
  return isWaiting;
}

/** 继续 sandbox 路径的 HITL：parked 轮走 respond，其余情况追加同会话消息。 */
export async function continueSandboxClarification(
  t: ScoreTestContext,
  wasWaiting: boolean,
  answer: string,
): Promise<void> {
  if (wasWaiting) {
    t.requireInputRequest();
    await t.respond(answer);
  } else {
    await t.send(answer);
  }
}
