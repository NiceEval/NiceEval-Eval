import { defineScoreEval } from "niceeval";
import { actionRef, command, gitCheckout, sandboxLayer } from "niceeval/sandbox";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";
import {
  archiveAgentOutput,
  checkAdapterPractice,
  checkAuthoringPractice,
  checkExecutionEvidence,
  checkExperimentDesign,
  checkInstallation,
  collectAgentSource,
  scoreDocumentationRouting,
  scoreEvalDesign,
  scoreIntegrationConversation,
} from "../../../lib/install/index.ts";
import { lettaCase } from "../../../fixtures/install/letta/case.ts";

/** 真实 Letta 接入：保留多轮记忆路径的设计检查，不把重服务起停当作文档分数。 */
export default defineScoreEval({
  description: "把 niceeval 接入 Letta（有状态记忆对话 agent / MemGPT）",
  judge: true,
  timeoutMs: 35 * 60 * 1000,
  sandbox: sandboxLayer()
    .before(gitCheckout({
      id: "niceeval-eval.install-fixture.letta-0.16.8.checkout",
      repository: "https://github.com/letta-ai/letta.git",
      ref: "1131535716e8a31c9a437f8695e25ac98f203a24",
      to: ".",
      changeFrequency: 20,
    }))
    .before(command("rm", ["-rf", ".git"], {
      id: "niceeval-eval.install-fixture.letta-0.16.8.detach",
      changeFrequency: 21,
      dependsOn: [actionRef("niceeval-eval.install-fixture.letta-0.16.8.checkout")],
    })),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");

    // Setup：候选文档落点；锁定的真实宿主已由本 Eval 的 fixture action 放进基线。
    assertPagesInCandidate(lettaCase.expectedPages, version);

    // 任务：只给安装引导与版本约束，实施内容由候选文档决定。
    const prompt =
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`;
    const turn = await t.send(prompt);

    // 检查：交互、安装 gate、实验、既有执行证据与作者面实践。
    await scoreIntegrationConversation(t, { clarify: lettaCase.clarify, turn });
    await checkInstallation(t, { version, standaloneWorkspace: true });
    await checkExperimentDesign(t);
    await checkExecutionEvidence(t);
    await checkAdapterPractice(t);
    await checkAuthoringPractice(t);

    // 收口：评审多轮 Eval 设计、文档路由并归档；首轮必须成功。
    const material = await collectAgentSource(t.sandbox);
    await scoreEvalDesign(t, lettaCase.quality, {
      input: "下面是待按给定判据评审的 agent 产出。",
      output: material,
    });
    await scoreDocumentationRouting(t, lettaCase.documentation);
    await archiveAgentOutput(t, "letta");
    turn.succeeded();
  },
});
