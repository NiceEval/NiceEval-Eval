import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * install 评估的默认配置：eval 让 agent 直接读这个版本按 tag 存档的 INIT.md，agent 按它走
 * 「读引导 → 探测项目 → 装候选版本 → init → 交接给随包 INDEX.md」这条完整链路。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.9.1");

export default defineExperiment({
  description: "niceeval@0.9.1：INIT.md + 随包文档",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["install/"],
  runs: 1,
  maxConcurrency: 2,
});
