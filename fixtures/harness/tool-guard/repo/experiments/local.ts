import { defineExperiment } from "niceeval";
import opsBot from "../agents/ops-bot.ts";

export default defineExperiment({
  description: "运维机器人的两条日常任务",
  adapter: opsBot,
  evals: ["ops/"],
  attempts: 1,
  maxConcurrency: 1,
});
