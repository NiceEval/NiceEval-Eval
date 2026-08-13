import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";
import {
  archiveAgentOutput,
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
import { skyvernCase } from "../../../fixtures/install/skyvern/case.ts";

/** 真实 Skyvern 接入：保留异步轮询路径的设计检查，不把浏览器服务起停当作文档分数。 */
export default defineScoreEval({
  description: "把 niceeval 接入 Skyvern（浏览器操作自动化 agent）",
  judge: true,
  timeoutMs: 35 * 60 * 1000,
  sandbox: fixtureSandbox(skyvernCase.fixture),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");

    // Setup：候选文档落点；锁定的真实宿主已由 fixture sandbox 放进基线。
    assertPagesInCandidate(skyvernCase.expectedPages, version);

    // 任务：只给安装引导与版本约束，实施内容由候选文档决定。
    const prompt =
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`;
    const turn = await t.send(prompt);

    // 检查：交互、安装 gate、实验、既有执行证据与作者面实践。
    await scoreIntegrationConversation(t, { clarify: skyvernCase.clarify, turn });
    await checkInstallation(t, { version, standaloneWorkspace: true });
    await checkExperimentDesign(t);
    await checkExecutionEvidence(t);
    await checkAdapterPractice(t);
    await checkAuthoringPractice(t);

    // 收口：评审浏览器操作 Eval 设计、文档路由并归档；首轮必须成功。
    const material = await collectAgentSource(t.sandbox, ["skyvern-frontend"]);
    await scoreEvalDesign(t, skyvernCase.quality, {
      input: "下面是待按给定判据评审的 agent 产出。",
      output: material,
    });
    await scoreDocumentationRouting(t, skyvernCase.documentation);
    await archiveAgentOutput(t, "skyvern");
    turn.succeeded().gate();
  },
});
