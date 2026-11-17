import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-wrong-argument",
  adapter: assistant,
  evals: ["support/"],
  attempts: 1,
  maxConcurrency: 1,
});
