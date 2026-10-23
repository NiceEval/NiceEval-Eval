import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installCodexAgent, installSandbox } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（npm 已发布版本的 semver 最大值，含预发布版）：从零接入`,
  adapter: installCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
