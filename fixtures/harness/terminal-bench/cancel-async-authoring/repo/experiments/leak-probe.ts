import { readFileSync } from "node:fs";
import { defineExperiment } from "niceeval";
import leakProbeAgent from "../agents/leak-probe.ts";

// 固定候选共用同一 fixture；0.19 起撤销 Experiment.agent。
const candidateMinor = Number(JSON.parse(readFileSync("node_modules/niceeval/package.json", "utf8")).version.split(".")[1]);
export default defineExperiment({
  description: "Hidden-material probe must remain an ordinary failed task result",
  ...(candidateMinor >= 19 ? { adapter: leakProbeAgent } : { agent: leakProbeAgent }),
  evals: ["terminal-bench/cancel-async-tasks"],
  attempts: 1,
  maxConcurrency: 1,
});
