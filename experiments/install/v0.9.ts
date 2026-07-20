import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 版本对比组：niceeval@0.9.x。
 *
 * 跟 v0.4.ts 只差 candidate 这一个变量，见那边的注释。
 *
 * 用前先打好这个 label 对应的候选：
 *   pnpm run pack:candidate -- 0.9.1 v0.9
 */
const CANDIDATE_LABEL = "v0.9";

export default defineExperiment({
  description: "niceeval@0.9.1（版本对比组）",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { candidateVersion: CANDIDATE_LABEL },
  sandbox: sandboxWith({ candidateLabel: CANDIDATE_LABEL }),
  evals: ["install/"],
  runs: 3,
  maxConcurrency: 2,
});
