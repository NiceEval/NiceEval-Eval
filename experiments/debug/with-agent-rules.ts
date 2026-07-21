import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 实验组：AGENTS.md 里有 `niceeval init` 写的托管区块。
 *
 * 这就是真实用户接入完之后的形态——区块把 agent 指向 `node_modules/niceeval/INDEX.md`，
 * 随包文档由此被真正接上。与对照组的差值，就是这条指针的价值。
 */
const NICEEVAL_VERSION = "0.9.1";

export default defineExperiment({
  description: "查结果：AGENTS.md 有 init 托管区块",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { agentRules: true, candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["debug/"],
  runs: 1,
  maxConcurrency: 2,
});
