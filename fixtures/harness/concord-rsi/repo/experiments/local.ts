import { defineExperiment } from "niceeval";
import assistant from "../agents/doc-assistant.ts";
export default defineExperiment({ adapter: assistant, evals: ["docs/"], attempts: 2, earlyExit: false, maxConcurrency: 4 });
