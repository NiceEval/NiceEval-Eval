import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 版本对比组：niceeval@0.4.1。
 *
 * 跟 v0.9.1.ts 只差版本这一个变量——同一个 model、同一批 eval、同样投放安装前
 * 引导文档。文档本身也是版本对齐的：这里的 INIT.md 是 0.4.1 发布时那份，不是今天
 * niceeval.com 上的最新文案（见 scripts/pin-candidate.ts）。
 *
 * 0.4.1 还没有随包文档这套机制（0 页、无 INDEX.md、init 也不写 AGENTS.md 托管区块），
 * 所以路由层在这一组读零是**正确结果**，正是这组要测出来的东西。
 *
 * 用前先钉好这个版本：
 *   pnpm exec tsx scripts/pin-candidate.ts 0.4.1
 */
const NICEEVAL_VERSION = "0.4.1";

export default defineExperiment({
  description: "niceeval@0.4.1（版本对比组）",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["install/"],
  runs: 1,
  maxConcurrency: 2,
});
