import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 实验组：完整文档链。
 *
 * fixture 里已经装好了候选包（结果数据随宿主项目一起签入），agent 可以读到
 * 随包 INDEX.md 与 CLI 参考页。
 */
export default defineExperiment({
  description: "查结果：有随包文档",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { bundledDocs: true },
  sandbox: sandboxWith(),
  evals: ["debug/"],
  runs: 3,
  maxConcurrency: 2,
});
