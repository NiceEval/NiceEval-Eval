import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-swallowed-error",
  adapter: assistant,
  evals: ["checkout/"],
  attempts: 1,
  maxConcurrency: 1,
});
