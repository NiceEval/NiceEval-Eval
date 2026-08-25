import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { installCodexAgent, installSandbox } from "../../lib/experiment-runtime.ts";

/**
 * npm latest（0.12.0）的安装基线：覆盖普通项目与复杂宿主的从零接入。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.12.0");

export default defineExperiment({
  description: "niceeval@0.12.0：自动安装基线",
  agent: installCodexAgent(),
  model: "gpt-5.6-terra",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: installSandbox(),
  evals: ["install/"],
  attempts: 1,
  maxConcurrency: 2,
});
