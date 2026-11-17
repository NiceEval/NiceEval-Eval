import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "trace-slow-assertion · local",
  adapter: assistant,
  model: "local",
  evals: ["docs/"],
  attempts: 1,
  earlyExit: false,
  maxConcurrency: 1,
});
