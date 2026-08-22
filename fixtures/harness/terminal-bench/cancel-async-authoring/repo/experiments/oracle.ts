import { defineExperiment } from "niceeval";
import oracleAgent from "../agents/oracle.ts";

export default defineExperiment({
  description: "Reference implementation must pass the authored cancel-async Eval",
  agent: oracleAgent,
  evals: ["terminal-bench/cancel-async-tasks"],
  attempts: 1,
  maxConcurrency: 1,
});
