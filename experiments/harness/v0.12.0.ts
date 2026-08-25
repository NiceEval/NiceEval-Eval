import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { harnessSandbox, incusCodexAgent } from "../../lib/experiment-runtime.ts";

/** 三道基于真实 Terminal-Bench task slice 的 Harness 工作流。 */
const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "niceeval@0.12.0：三道 Terminal-Bench Harness 运行、反馈与 authoring 闭环",
  agent: incusCodexAgent(),
  model: "gpt-5.6-terra",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: harnessSandbox(NICEEVAL_VERSION),
  evals: (evalDef) => evalDef.tags.includes("harness"),
  maxConcurrency: 2,
});
