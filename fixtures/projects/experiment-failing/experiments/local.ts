import { defineExperiment } from "niceeval";
import policyAgent from "../agents/policy.ts";

export default defineExperiment({
  description: "deterministic policy-agent regression",
  agent: policyAgent,
  evals: ["policy/"],
  attempts: 1,
});
