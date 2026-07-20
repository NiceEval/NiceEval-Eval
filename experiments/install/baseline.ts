import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * install 评估的默认配置：投放 INIT.md，agent 按它走「读引导 → 探测项目 →
 * 装候选版本 → init → 交接给随包 INDEX.md」这条完整链路。
 *
 * 用前先钉好这个版本：
 *   pnpm exec tsx scripts/pin-candidate.ts 0.9.1
 */
const CANDIDATE_VERSION = "0.9.1";

export default defineExperiment({
  description: "niceeval@0.9.1：INIT.md + 随包文档",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { candidateVersion: CANDIDATE_VERSION },
  sandbox: sandboxWith(CANDIDATE_VERSION),
  evals: ["install/"],
  runs: 3,
  maxConcurrency: 2,
});
