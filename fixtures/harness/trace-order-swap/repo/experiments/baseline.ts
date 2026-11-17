import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-order-swap · baseline",
  adapter: assistant,
  model: "baseline",
  evals: ["support/"],
  attempts: 1,
  earlyExit: false,
  maxConcurrency: 1,
});
