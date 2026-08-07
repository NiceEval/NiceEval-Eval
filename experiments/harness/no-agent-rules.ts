import { defineExperiment } from "niceeval";
import { agentUnderTest, EVAL_MAX_CONCURRENCY, sandboxWith } from "../shared.ts";

/**
 * 对照组：不运行 `niceeval init`。每道题的起始 repo 与题面都和实验组相同，唯一差异是
 * AGENTS.md 中没有指向随包 INDEX.md 的托管区块。
 */
const NICEEVAL_VERSION = "0.9.1";

export default defineExperiment({
  description: "Harness 诊断：AGENTS.md 无 init 托管区块",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { agentRules: false, candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["harness/"],
  attempts: 1,
  maxConcurrency: EVAL_MAX_CONCURRENCY,
});
