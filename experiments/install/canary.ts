import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installCodexAgent, installSandbox } from "../../lib/experiment-runtime.ts";

/**
 * 金丝雀组：npm 全部已发布版本按 semver 取最大值，包含预发布版。
 *
 * 候选身份就是 npm 版本号（精确复现、INIT.md 按 tag 取、安装 gate 对版本号）。
 * 每次加载重新解析；canary tag 过期时自然使用更新的稳定版（见 ensureCandidate）。
 */
const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（npm 已发布版本的 semver 最大值，含预发布版；自动安装）`,
  adapter: installCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
