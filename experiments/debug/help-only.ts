import { defineExperiment } from "niceeval";
import { RUN_PROFILE, agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 对照组：只允许 --help 裸查。
 *
 * 与实验组的差值，就是随包文档对诊断链路的增量：CLI 自带的 --help 已经能说清
 * 每个 flag 干什么，随包文档要证明的是它比 --help 多给出了「什么时候该用哪一段钻取」。
 *
 * 边界说明：随包文档是包的一部分，物理上没法从 sandbox 里摘掉。这一组靠任务指令
 * 约束 agent 只用 --help，属于「要求配合」而非「强制隔离」——路由层会记录它到底
 * 有没有偷看文档，分析时应该把偷看了的 attempt 单独剔出来再算差值。
 */
export default defineExperiment({
  description: "查结果：只用 --help",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { bundledDocs: false },
  sandbox: sandboxWith({ withInitDoc: false }),
  evals: ["queries"],
  ...RUN_PROFILE,
});
