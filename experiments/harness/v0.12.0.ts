import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { ensureCandidate } from "../../lib/candidate.ts";
import { sandboxWith } from "../../lib/experiment-runtime.ts";

/** 三道无历史记录的 Harness 工作流：补回归、分层修复 failed、修复局部 errored。 */
const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "niceeval@0.12.0：三道 Harness 运行与反馈闭环",
  agent: codexAgent(),
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("node", NICEEVAL_VERSION),
  evals: (evalDef) => evalDef.tags.includes("harness"),
  attempts: 3,
});
