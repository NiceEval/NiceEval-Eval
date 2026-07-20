import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * install 评估的默认配置：投放 INIT.md，agent 按它走「读引导 → 探测项目 →
 * 装候选包 → init → 交接给随包 INDEX.md」这条完整链路。
 */
export default defineExperiment({
  description: "安装前引导文档（INIT.md）+ 随包文档",
  agent: agentUnderTest,
  model: "gpt-5.4",
  sandbox: sandboxWith(),
  evals: ["install/"],
  runs: 3,
  maxConcurrency: 2,
});
