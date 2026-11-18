import { defineExperiment } from "niceeval";
import { resolveCandidate } from "../../../lib/candidate.ts";
import {
  agentEndpointCheck,
  harnessProject,
  installCandidate,
  instabox,
  niceevalInit,
  removeInitExamples,
  sandboxCodexAgent,
} from "../../../lib/sandbox.ts";

// canary 每次加载时从 npm 全部已发布版本按 semver 取最大值（含预发布版），不依赖 dist-tag。
const version = resolveCandidate("canary");

// 已装好候选的项目里运行、诊断、修复与编写 Eval；agent 拿到的是这个版本的全部：CLI、类型声明与随包文档。
export default defineExperiment({
  description: `niceeval@${version}（npm 已发布版本的 semver 最大值，含预发布版）：Harness 运行、反馈与 authoring 闭环`,
  adapter: sandboxCodexAgent(),
  model: "gpt-6.2-sol",
  reasoningEffort: "medium",
  attempts: 1,
  earlyExit: false,
  flags: { candidateVersion: version, harnessRubric: "v2" },
  sandbox: instabox
    .before(harnessProject)
    .before(installCandidate(version))
    .before(niceevalInit)
    .before(removeInitExamples)
    .before(agentEndpointCheck),
  evals: ["harness/"],
});
