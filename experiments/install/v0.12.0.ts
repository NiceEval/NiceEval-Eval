import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, EVAL_MAX_CONCURRENCY, sandboxWith } from "../shared.ts";

/**
 * npm latest（0.12.0）的端到端基线：从普通/复杂项目安装，一直覆盖到
 * 已接入项目的运行、失败调试与迁移反馈闭环。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "niceeval@0.12.0：安装与反馈闭环基线",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("python"),
  evals: ["install/", "advance/", "experiment/"],
  attempts: 1,
  maxConcurrency: EVAL_MAX_CONCURRENCY,
});
