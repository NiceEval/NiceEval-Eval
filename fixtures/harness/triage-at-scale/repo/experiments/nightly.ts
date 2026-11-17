import { defineExperiment } from "niceeval";
import assistant from "../agents/assistant.ts";

export default defineExperiment({
  description: "电商客服 nightly 回归评估",
  adapter: assistant,
  model: "shop-assistant",
  evals: ["billing/", "support/", "shipping/", "returns/", "account/", "catalog/"],
  attempts: 3,
  earlyExit: false,
  maxConcurrency: 1,
});
