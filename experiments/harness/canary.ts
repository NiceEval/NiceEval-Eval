import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { ensureCandidate } from "../../lib/candidate.ts";
import { sandboxWith } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（canary）：两道 Terminal-Bench Harness 运行与反馈闭环`,
  agent: codexAgent(),
  model: "gpt-5.6-terra",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("node", NICEEVAL_VERSION),
  evals: (evalDef) => evalDef.tags.includes("harness"),
  attempts: 3,
});
