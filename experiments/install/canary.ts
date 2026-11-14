import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installSandbox, sandboxCodexAgent } from "../../lib/experiment-runtime.ts";

// canary 每次加载时从 npm 全部已发布版本按 semver 取最大值（含预发布版），不依赖 dist-tag。
const version = await ensureCandidate("canary");

// 从零接入：agent 只拿到一句 prompt 和该版本 tag 下的 INIT.md。
export default defineExperiment({
  description: `niceeval@${version}（npm 已发布版本的 semver 最大值，含预发布版）：从零接入`,
  adapter: sandboxCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: version },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
