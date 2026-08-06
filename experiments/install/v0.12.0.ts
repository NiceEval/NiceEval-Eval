import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * npm latest（0.12.0），install 组当前基线格。与 canary、v0.11.0 使用同一个 model、
 * 同一批 eval；候选版本是唯一自变量。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "niceeval@0.12.0：当前发布版安装基线",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("python"),
  evals: ["install/"],
  attempts: 1,
});
