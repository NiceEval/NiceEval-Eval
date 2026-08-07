import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, EVAL_MAX_CONCURRENCY, sandboxWith } from "../shared.ts";

/**
 * 历史结果诊断基线。fixture 来自 NiceEval 0.4.6 的 schema 8，0.9.1 是最后验证过
 * 能完整读取它的 reader。这里运行 `niceeval init`，同时评估该版本的随包文档路由。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.9.1");

export default defineExperiment({
  description: "niceeval@0.9.1：历史结果 Harness 诊断",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { agentRules: true, candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["harness/"],
  attempts: 1,
  maxConcurrency: EVAL_MAX_CONCURRENCY,
});
