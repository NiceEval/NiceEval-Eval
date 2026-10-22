import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { harnessSandbox, incusCodexAgent } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（canary）：四个条件、三个任务家族的 Terminal-Bench Harness 运行、反馈与 authoring 闭环`,
  adapter: incusCodexAgent(),
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
  attempts: 1,
  earlyExit: false,
  flags: { candidateVersion: NICEEVAL_VERSION, harnessRubric: "v2" },
  sandbox: harnessSandbox(NICEEVAL_VERSION),
  evals: (evalDef) => evalDef.tags.includes("harness"),
});
