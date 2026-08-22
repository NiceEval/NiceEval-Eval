import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";
import {
  archiveAgentOutput,
  checkAdapterConnection,
  checkAdapterPractice,
  checkAuthoringPractice,
  checkExecutionEvidence,
  checkExperimentDesign,
  checkInstallation,
  collectAgentSource,
  fixtureSandbox,
  scoreDocumentationRouting,
  scoreEvalDesign,
  scoreIntegrationConversation,
} from "../../../lib/install/index.ts";
import { gptResearcherCase } from "../../../fixtures/install/gpt-researcher/case.ts";

/** 真实 GPT Researcher 接入：安装、首个 Eval、WebSocket 路径取证与收口。 */
export default defineScoreEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",
  judge: true,
  timeoutMs: 35 * 60 * 1000,
  sandbox: fixtureSandbox(gptResearcherCase.fixture),
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // Setup：候选文档落点；锁定的真实宿主已由 fixture sandbox 放进基线。
    assertPagesInCandidate(gptResearcherCase.expectedPages, version);

    // 任务：只给安装引导与版本约束，实施内容由候选文档决定。
    const prompt =
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`;
    const turn = await t.send(prompt);

    try {
      // 先验收计分制里的关键闭环；任一 orStop 都保留已得部分分，但不再发放后续质量奖励。
      await scoreIntegrationConversation(t, {
        clarify: gptResearcherCase.clarify,
        createEval: { quality: gptResearcherCase.quality, comparisonOptions: gptResearcherCase.clarify.flags },
        scoring: "outcome-weighted",
        turn,
      });
      await checkInstallation(t, {
        version,
        standaloneWorkspace: true,
        scoring: "outcome-weighted",
      });
      await checkAdapterConnection(t, { scoring: "outcome-weighted" });
      await checkExecutionEvidence(t, { scoring: "outcome-weighted" });

      // 闭环成立后，再评实验、adapter、Eval 写法与设计质量。
      await checkExperimentDesign(t);
      await checkAdapterPractice(t);
      await checkAuthoringPractice(t);
      const material = await collectAgentSource(t.sandbox);
      await scoreEvalDesign(t, gptResearcherCase.quality, { input: prompt, output: material });
      await scoreDocumentationRouting(t, gptResearcherCase.documentation);
    } finally {
      // orStop 也必须保留本次产物，供人工复审。
      await archiveAgentOutput(t, "gpt-researcher");
    }
  },
});
