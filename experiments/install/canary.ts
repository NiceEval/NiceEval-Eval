import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installCodexAgent, installSandbox } from "../../lib/experiment-runtime.ts";

/**
 * 金丝雀组：main 的最新快照，走 npm canary dist-tag。
 *
 * 候选身份就是 npm 版本号（精确复现、INIT.md 按 tag 取、安装 gate 对版本号），所以 main
 * 想进对比组，先在 niceeval 仓库触发 Canary workflow 发一个 `X.Y.Z-canary.<n>`。
 * 每次加载都问 npm canary 指向哪版，本地没有就现场物化（见 ensureCandidate）。
 */
const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（main 快照，自动安装）`,
  adapter: installCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
