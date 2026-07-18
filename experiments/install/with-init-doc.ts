import { defineExperiment } from "niceeval";
import { RUN_PROFILE, agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 实验组：给完整文档链。
 *
 * 沙箱里投放 INIT.md，agent 按它走「读引导 → 探测项目 → 装候选包 → init →
 * 交接给随包 INDEX.md」这条完整链路。
 */
export default defineExperiment({
  description: "有安装前引导文档（INIT.md）+ 随包文档",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { initDoc: true },
  sandbox: sandboxWith({ withInitDoc: true }),
  ...RUN_PROFILE,
});
