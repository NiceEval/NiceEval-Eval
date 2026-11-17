import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "知识库助手 · 新提示词",
  adapter: assistant,
  model: "candidate",
  evals: [""],
  attempts: 1,
  maxConcurrency: 1,
});
