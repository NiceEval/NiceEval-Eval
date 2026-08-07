import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { ensureCandidate } from "../../lib/candidate.ts";
import { sandboxWith } from "../../lib/experiment-runtime.ts";

/** 当前 Harness 工作流：运行、结果下钻与失败修复。 */
const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "niceeval@0.12.0：Harness 运行与反馈闭环",
  agent: codexAgent(),
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("node"),
  evals: (evalDef) => evalDef.tags.includes("harness-v0.12.0"),
  attempts: 1,
});
