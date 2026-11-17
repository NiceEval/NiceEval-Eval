import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-flaky-cause · local",
  adapter: assistant,
  model: "local",
  evals: ["weather/"],
  attempts: 4,
  earlyExit: false,
  maxConcurrency: 1,
});
