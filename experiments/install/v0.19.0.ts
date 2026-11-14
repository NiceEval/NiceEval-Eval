import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installSandbox, sandboxCodexAgent } from "../../lib/experiment-runtime.ts";

const version = await ensureCandidate("0.19.0");

// 从零接入：agent 只拿到一句 prompt 和该版本 tag 下的 INIT.md。
export default defineExperiment({
  description: `niceeval@${version}（历史对照）：从零接入`,
  adapter: sandboxCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: version },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
