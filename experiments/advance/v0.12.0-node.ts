import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, EVAL_MAX_CONCURRENCY, sandboxWith } from "../shared.ts";

const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "高级安装路径：Express coding-agent Sandbox（Node）",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("node"),
  evals: ["advance/express-coding-agent"],
  attempts: 1,
  maxConcurrency: EVAL_MAX_CONCURRENCY,
});
