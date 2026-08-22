/**
 * 安装题的对话阶段：先计分首轮澄清，再用固定用户答复让同一会话继续。
 *
 * 这里仅编排对话与通用 rubric；每道题的宿主事实、专属 rubric 和 HITL 答复留在对应
 * fixtures/install/<case>/ 中，避免反向把题目差异藏进万能 runner。
 */

import type { ScoreTestContext } from "niceeval";
import { equals, isTrue } from "niceeval/expect";
import { buildClarifyRubrics, type ClarifyFacts } from "./criteria/clarification.ts";
import {
  buildCreateEvalHandoffRubrics,
  buildCreateEvalScopingRubrics,
  type CreateEvalFacts,
} from "./criteria/first-eval.ts";
import { INSTALL_OUTCOME_POINTS, isOutcomeWeighted, type InstallScoringMode } from "./scoring.ts";

type Turn = Awaited<ReturnType<ScoreTestContext["send"]>>;

export interface IntegrationConversationOptions {
  clarify: ClarifyFacts;
  turn: Turn;
  /** 常见安装路径还要评「首次 Eval 定题」与「完成交接」。 */
  createEval?: CreateEvalFacts;
  /**
   * install 正式题使用结果优先模式：完成轮本身计 3 分，未完成则保留此前部分分并停止后续评分。
   * roadmap 题省略时保持原来的纯加分行为。
   */
  scoring?: InstallScoringMode;
}

/** 计分通用接入澄清，并以原有 Tier 1 答复继续同一会话。 */
export async function scoreIntegrationConversation(
  t: ScoreTestContext,
  opts: IntegrationConversationOptions,
): Promise<void> {
  const createEval = opts.createEval;
  const outcomeWeighted = isOutcomeWeighted(opts.scoring);
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

  if (createEval) {
    await t.group("首次评估定题", async () => {
      for (const [index, rubric] of buildCreateEvalScopingRubrics(createEval).entries()) {
        opts.turn.judge.autoevals.closedQA(`【${rubric.key}】${rubric.criteria}`)
          .score(1)
          .key(`install.interaction.eval-scope.${index + 1}`)
          .label(rubric.key);
      }
    });
  }

  const experimentScope = createEval ? "先做最小实验矩阵" : "写两个实验";
  const createEvalAnswer = createEval
    ? "第一条 Eval 就测你从仓库确认的核心用例，用安全的本地 fixture / 测试数据；" +
      "成功标准落在具体业务结果上，再加一条不在 prompt 里教标准答案的负例。" +
      "候选只用系统实际接受的值，验证不了就先交一个可运行参照配置并说明。" +
      "首跑每格一次、只跑最小矩阵，不扩大付费范围；"
    : "";
  const answer =
    `简单接入——${experimentScope}、先不接 otel，也先不做 flag。` +
    "接口就用你探到的那个；被测服务需要的话你自己起；judge 按文档处理，没有可用 key 就降级。" +
    createEvalAnswer +
    "其余你自行决定，不用再等我确认。";
  const handoffTurn = opts.turn.status === "waiting"
    ? await t.respond(answer)
    : await t.send(answer);

  if (createEval) {
    await t.group("完成交接", async () => {
      for (const [index, rubric] of buildCreateEvalHandoffRubrics(createEval).entries()) {
        handoffTurn.judge.autoevals.closedQA(`【${rubric.key}】${rubric.criteria}`)
          .score(1)
          .key(`install.interaction.handoff.${index + 1}`)
          .label(rubric.key);
      }
    });
  }

  if (outcomeWeighted) {
    await handoffTurn.succeeded()
      .score(INSTALL_OUTCOME_POINTS.completedTurn)
      .key("install.interaction.completed")
      .label("完成轮成功")
      .orStop();
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
