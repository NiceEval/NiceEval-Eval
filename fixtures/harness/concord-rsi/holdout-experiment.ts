import { defineExperiment } from "niceeval";
import assistant from "../agents/doc-assistant.ts";
export default defineExperiment({ adapter: assistant, evals: ["holdout/"], attempts: 3, earlyExit: false, maxConcurrency: 4 });
