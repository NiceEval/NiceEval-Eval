import { defineExperiment } from "niceeval";
import policyAgent from "../agents/policy.ts";

export default defineExperiment({
  description: "legacy deterministic policy-agent smoke test",
  agent: policyAgent,
  evals: ["policy/"],
  runs: 1,
});
