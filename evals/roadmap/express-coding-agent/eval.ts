import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";
import {
  archiveAgentOutput,
  checkAuthoringPractice,
  checkExecutionEvidence,
  checkExperimentDesign,
  checkInstallation,
  checkSandboxProvisioning,
  collectAgentSource,
  continueSandboxClarification,
  fixtureSandbox,
  scoreDocumentationRouting,
  scoreEvalDesign,
  scoreSandboxClarification,
} from "../../../lib/install/index.ts";
import { expressCodingAgentCase } from "../../../fixtures/install/express-coding-agent/case.ts";
import { sandboxClarifyRubrics } from "../../../fixtures/install/express-coding-agent/rubrics.ts";

/** Express sandbox 路径：评的是 coding agent，重点是可复现的预制 sandbox 方案。 */
export default defineScoreEval({
  description: "为 Express 仓库搭一套评 coding agent 的沙箱评估（考 sandbox/template 创建）",
  judge: true,
  timeoutMs: 35 * 60 * 1000,
  sandbox: fixtureSandbox(expressCodingAgentCase.fixture),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");

    // Setup：候选文档落点；锁定的真实 Express 宿主已由 fixture sandbox 放进基线。
    assertPagesInCandidate(expressCodingAgentCase.expectedPages, version);

    // 任务：表达隔离、可复现的用户意图，不预告 provider 或模板解法。
    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `We want to evaluate coding agents working on real tasks in this repo — ` +
      `every eval attempt must run in an isolated, reproducible environment.\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // 检查首轮澄清，再以既定 HITL 答复继续同一会话。
    const wasWaiting = await scoreSandboxClarification(t, turn, sandboxClarifyRubrics);
    await continueSandboxClarification(t, wasWaiting, expressCodingAgentCase.sandboxClarificationAnswer);

    // 检查安装 gate、实验、执行证据和 Eval 作者面实践。
    await checkInstallation(t, { version });
    await checkExperimentDesign(t);
    await checkExecutionEvidence(t);
    await checkAuthoringPractice(t);

    // 收口：评审 Eval 设计、sandbox 预制、文档路由并归档；首轮必须成功。
    const material = await collectAgentSource(t.sandbox);
    await scoreEvalDesign(t, expressCodingAgentCase.quality, {
      input: "下面是待按给定判据评审的 agent 产出。",
      output: material,
    });
    await checkSandboxProvisioning(t, { material });
    await scoreDocumentationRouting(t, expressCodingAgentCase.documentation);
    await archiveAgentOutput(t, "express-coding-agent");
    turn.succeeded().gate();
  },
});
