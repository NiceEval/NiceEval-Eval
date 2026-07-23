import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 金丝雀组：main 的最新快照，走 canary 预发布通道。
 *
 * 跟 v0.9.1.ts / v0.4.ts 只差版本这一个变量——同一个 model、同一批 eval。「未发版的
 * main」不直接从 git 装：候选身份 = npm 版本号是这套基建的地基（精确复现、INIT.md 按
 * tag 取、安装 gate 对版本号），所以 main 想进对比组，先在 niceeval 仓库的 Actions 里
 * 点一下 Canary workflow（.github/workflows/canary.yml），它会从 main 自动发一个
 * `X.Y.Z-canary.<n>` 到 npm 的 canary dist-tag 并打好 tag。
 *
 * 版本不写死、也不在本地落指针：每次加载直接问 npm「canary 现在指向哪版」，本地没有
 * 这版的 manifest 就现场物化（见 ensureCandidate）。发新 canary 后什么都不用做，
 * 下一次跑自动跟上。
 */
const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（main 快照，金丝雀对比组）`,
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["install/"],
  runs: 1,
  maxConcurrency: 2,
});
