import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { ensureCandidate } from "../../lib/candidate.ts";
import { sandboxWith } from "../../lib/experiment-runtime.ts";

/**
 * 历史结果诊断基线。fixture 来自 NiceEval 0.4.6 的 schema 8，0.9.1 是最后验证过
 * 能完整读取它的 reader。这里运行 `niceeval init`，同时评估该版本的随包文档路由。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.9.1");

export default defineExperiment({
  description: "niceeval@0.9.1：历史结果 Harness 诊断",
  agent: codexAgent(),
  model: "gpt-5.4",
  flags: { agentRules: true, candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: (evalDef) => evalDef.tags.includes("harness-v0.9.1"),
  attempts: 1,
});
