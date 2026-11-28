import { defineExperiment } from "niceeval";
import { resolveCanaryCandidate } from "../../lib/canary-candidate.ts";
import {
  agentEndpointCheck,
  instabox,
  sandboxCodexAgent,
  targetAppEnv,
  targetAppSecretsDir,
} from "../../lib/sandbox.ts";

const version = resolveCanaryCandidate();

// 从零接入：agent 只拿到一句 prompt 和该版本 tag 下的 INIT.md。
export default defineExperiment({
  description: `niceeval@${version}：从零接入`,
  adapter: sandboxCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: version },
  sandbox: instabox
    .before(targetAppSecretsDir)
    .before(agentEndpointCheck)
    .before(targetAppEnv),
  evals: ["install/"],
  attempts: 1,
});
