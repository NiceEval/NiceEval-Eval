import { defineExperiment } from "niceeval";
import leakProbeAgent from "../agents/leak-probe.ts";

export default defineExperiment({
  description: "Hidden-material probe must remain an ordinary failed task result",
  adapter: leakProbeAgent,
  evals: ["terminal-bench/cancel-async-tasks"],
  attempts: 1,
  maxConcurrency: 1,
});
