import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installCodexAgent, installSandbox } from "../../lib/experiment-runtime.ts";

const NICEEVAL_VERSION = await ensureCandidate("0.14.0");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（稳定版，自动安装）`,
  adapter: installCodexAgent(),
  model: "gpt-6.1-sol",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
});
