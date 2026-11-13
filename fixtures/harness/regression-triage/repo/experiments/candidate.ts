import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "客服助手 · atlas-2（准备换上去的模型）",
  adapter: assistant,
  model: "atlas-2",
  evals: ["support/"],
  attempts: 1,
  maxConcurrency: 1,
});
