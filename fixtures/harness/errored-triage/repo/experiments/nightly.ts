import { defineExperiment } from "niceeval";
import assistant from "../agents/research-assistant.ts";
export default defineExperiment({ adapter: assistant, evals: ["nightly/"], attempts: 1, maxConcurrency: 1 });
