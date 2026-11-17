import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-order-swap · candidate",
  adapter: assistant,
  model: "candidate",
  evals: ["support/"],
  attempts: 1,
  earlyExit: false,
  maxConcurrency: 1,
});
