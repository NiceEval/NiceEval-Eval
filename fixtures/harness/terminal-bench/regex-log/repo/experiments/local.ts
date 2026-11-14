import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import runtimeAgent from "../agents/canned-terminal-bench.ts";

const RUNTIME_IMAGE = "niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96";

export default defineExperiment({
  description: "Terminal-Bench task slice with one Python-dependent verifier",
  adapter: runtimeAgent,
  sandbox: dockerSandbox({ source: { type: "image", image: RUNTIME_IMAGE } }),
  evals: ["terminal-bench/"],
  attempts: 1,
  maxConcurrency: 1,
});
