import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, EVAL_MAX_CONCURRENCY, sandboxWith } from "../shared.ts";

const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "高级安装路径：Letta / OpenHands / Skyvern（Python）",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("python"),
  evals: ["advance/letta", "advance/openhands", "advance/skyvern"],
  attempts: 1,
  maxConcurrency: EVAL_MAX_CONCURRENCY,
});
