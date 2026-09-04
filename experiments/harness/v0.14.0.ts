import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { ensureCandidate } from "../../lib/candidate.ts";
import { harnessSandbox } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("0.14.0");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（稳定版）：三道 Terminal-Bench Harness 运行、反馈与 authoring 闭环`,
  agent: codexAgent(),
  model: "gpt-5.6-terra",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: harnessSandbox(NICEEVAL_VERSION),
  evals: (evalDef) => evalDef.tags.includes("harness"),
});
