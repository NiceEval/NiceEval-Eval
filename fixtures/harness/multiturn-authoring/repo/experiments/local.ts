import { defineExperiment } from "niceeval";
import bookingBot from "../agents/booking-bot.ts";
export default defineExperiment({ adapter: bookingBot, evals: ["booking/"], attempts: 1 });
