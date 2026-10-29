import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { harnessSandbox, sandboxCodexAgent } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（npm 已发布版本的 semver 最大值，含预发布版）：五个条件、三个任务家族的 Terminal-Bench Harness 运行、反馈与 authoring 闭环`,
  adapter: sandboxCodexAgent(),
  model: "gpt-6.1-sol",
  reasoningEffort: "medium",
  attempts: 1,
  earlyExit: false,
  flags: { candidateVersion: NICEEVAL_VERSION, harnessRubric: "v2" },
  sandbox: harnessSandbox(NICEEVAL_VERSION),
  evals: ["harness/"],
});
