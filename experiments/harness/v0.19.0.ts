import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { harnessSandbox, sandboxCodexAgent } from "../../lib/experiment-runtime.ts";

const version = await ensureCandidate("0.19.0");

// 已装好候选的项目里运行、诊断、修复与编写 Eval；agent 拿到的是这个版本的全部：CLI、类型声明与随包文档。
export default defineExperiment({
  description: `niceeval@${version}（历史对照）：Harness 运行、反馈与 authoring 闭环`,
  adapter: sandboxCodexAgent(),
  model: "gpt-6.1-sol",
  reasoningEffort: "medium",
  attempts: 1,
  earlyExit: false,
  flags: { candidateVersion: version, harnessRubric: "v2" },
  sandbox: harnessSandbox(version),
  evals: ["harness/"],
});
