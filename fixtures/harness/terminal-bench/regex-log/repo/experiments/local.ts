import { readFileSync } from "node:fs";
import { defineExperiment } from "niceeval";
import * as niceevalSandbox from "niceeval/sandbox";
import runtimeAgent from "../agents/canned-terminal-bench.ts";

const sandbox = niceevalSandbox as unknown as Record<string, unknown>;
const dockerImageSandbox = sandbox.dockerImageSandbox as ((options: { image: string }) => unknown) | undefined;
const dockerSandbox = sandbox.dockerSandbox as ((options: unknown) => unknown) | undefined;
const hasLayeredDockerApi = typeof sandbox.dockerComposeSandbox === "function";
const RUNTIME_IMAGE = "cache.invalid/niceeval-harness/runtime:node";

if (dockerImageSandbox === undefined && dockerSandbox === undefined) {
  throw new Error("installed niceeval lacks a Docker sandbox factory required by this fixture");
}

const runtimeSandbox = dockerImageSandbox !== undefined
  ? dockerImageSandbox({ image: RUNTIME_IMAGE })
  : hasLayeredDockerApi
    ? dockerSandbox!({ source: { type: "image", image: RUNTIME_IMAGE } })
    : dockerSandbox!({ image: RUNTIME_IMAGE });

// 固定候选共用同一 fixture；0.19 起撤销 Experiment.agent。
const candidateMinor = Number(JSON.parse(readFileSync("node_modules/niceeval/package.json", "utf8")).version.split(".")[1]);
export default defineExperiment({
  description: "Terminal-Bench task slice with one Python-dependent verifier",
  ...(candidateMinor >= 19 ? { adapter: runtimeAgent } : { agent: runtimeAgent }),
  sandbox: runtimeSandbox as never,
  evals: ["terminal-bench/"],
  attempts: 1,
  maxConcurrency: 1,
});
