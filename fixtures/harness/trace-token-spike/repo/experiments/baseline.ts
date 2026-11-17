import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "知识库助手 · 原提示词",
  adapter: assistant,
  model: "baseline",
  evals: [""],
  attempts: 1,
  maxConcurrency: 1,
});
