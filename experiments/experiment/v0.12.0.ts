import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, sandboxWith } from "../shared.ts";

const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "操作实验：运行、失败调试、自迭代与 0.9 → 0.12 长程迁移",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("node"),
  evals: ["experiment/"],
  attempts: 1,
  maxConcurrency: 2,
});
