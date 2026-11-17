import { defineExperiment } from "niceeval";
import bot from "../agents/research-bot.ts";
export default defineExperiment({ adapter: bot, evals: ["research/"], attempts: 4, earlyExit: false });
