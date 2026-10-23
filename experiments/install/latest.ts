import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installCodexAgent, installSandbox } from "../../lib/experiment-runtime.ts";

/**
 * 真实用户的从零接入：agent 只拿到一句 prompt 和该版本的 INIT.md，按 INIT 安装的是 npm latest，
 * 所以这里只评 latest。加载时解析成精确版本，作为安装 gate 的期望值。
 */
const NICEEVAL_VERSION = await ensureCandidate("latest");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（npm latest，零样本接入）`,
  adapter: installCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
