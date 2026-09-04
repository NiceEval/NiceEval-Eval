import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { harnessSandbox, incusCodexAgent } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("0.14.2");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（稳定版）：改进后的三道 Terminal-Bench Harness 运行、反馈与 authoring 闭环`,
  agent: incusCodexAgent(),
  model: "gpt-5.6-terra",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: harnessSandbox(NICEEVAL_VERSION),
  evals: (evalDef) => evalDef.tags.includes("harness"),
});
