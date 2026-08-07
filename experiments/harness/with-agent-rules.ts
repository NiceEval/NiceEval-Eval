import { defineExperiment } from "niceeval";
import { agentUnderTest, EVAL_MAX_CONCURRENCY, sandboxWith } from "../shared.ts";

/**
 * 实验组：在 agent 开始前运行 `niceeval init`，让 AGENTS.md 托管区块把它路由到候选包的
 * INDEX.md。与对照组相比，题面、起始 repo、reader、模型和运行档位都不变。
 */
const NICEEVAL_VERSION = "0.9.1";

export default defineExperiment({
  description: "Harness 诊断：AGENTS.md 有 init 托管区块",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { agentRules: true, candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["harness/"],
  attempts: 1,
  maxConcurrency: EVAL_MAX_CONCURRENCY,
});
