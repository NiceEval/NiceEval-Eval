import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-slow-turn",
  adapter: assistant,
  evals: ["booking/"],
  attempts: 1,
  maxConcurrency: 1,
});
