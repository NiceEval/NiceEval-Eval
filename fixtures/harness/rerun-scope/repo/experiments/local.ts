import { defineExperiment } from "niceeval";
import supportBot from "../agents/support-bot.ts";

export default defineExperiment({
  description: "客服机器人的五条回归评估",
  adapter: supportBot,
  evals: ["support/"],
  attempts: 1,
  maxConcurrency: 1,
});
