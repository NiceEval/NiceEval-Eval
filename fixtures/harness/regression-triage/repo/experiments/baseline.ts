import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "客服助手 · atlas-1（线上在用的模型）",
  adapter: assistant,
  model: "atlas-1",
  evals: ["support/"],
  attempts: 1,
  maxConcurrency: 1,
});
