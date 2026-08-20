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
import { dbGptCase } from "../../../fixtures/install/db-gpt/case.ts";

/** 真实 DB-GPT 接入：安装、首个 Eval、轻量端到端取证与收口。 */
export default defineScoreEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  judge: true,
  timeoutMs: 35 * 60 * 1000,
  sandbox: fixtureSandbox(dbGptCase.fixture),
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // Setup：候选文档落点；锁定的真实宿主已由 fixture sandbox 放进基线。
    assertPagesInCandidate(dbGptCase.expectedPages, version);

    // 任务：只给安装引导与版本约束，实施内容由候选文档决定。
    const prompt =
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`;
    const turn = await t.send(prompt);

    // 检查：交互、安装 gate、实验、adapter、运行证据与作者面实践。
    await scoreIntegrationConversation(t, {
      clarify: dbGptCase.clarify,
      createEval: { quality: dbGptCase.quality, comparisonOptions: dbGptCase.clarify.flags },
      turn,
    });
    await checkInstallation(t, { version, standaloneWorkspace: true });
    await checkExperimentDesign(t);
    await checkAdapterConnection(t);
    await checkExecutionEvidence(t);
    await checkAdapterPractice(t);
    await checkAuthoringPractice(t);

    // 收口：评审产出设计、文档路由并归档；首轮必须成功。
    const material = await collectAgentSource(t.sandbox);
    await scoreEvalDesign(t, dbGptCase.quality, { input: prompt, output: material });
    await scoreDocumentationRouting(t, dbGptCase.documentation);
    await archiveAgentOutput(t, "db-gpt");
    turn.succeeded();
  },
});
