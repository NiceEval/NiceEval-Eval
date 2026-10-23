import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import runtimeAgent from "../agents/canned-terminal-bench.ts";

const RUNTIME_IMAGE = "cache.invalid/niceeval-harness/runtime:node";

export default defineExperiment({
  description: "Terminal-Bench task slice with one Python-dependent verifier",
  adapter: runtimeAgent,
  sandbox: dockerSandbox({ source: { type: "image", image: RUNTIME_IMAGE } }),
  evals: ["terminal-bench/"],
  attempts: 1,
  maxConcurrency: 1,
});
