import { defineExperiment } from "niceeval";
import bot from "../agents/flight-bot.ts";
export default defineExperiment({ adapter: bot, evals: ["flight/"], attempts: 1, earlyExit: false });
