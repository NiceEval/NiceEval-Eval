import { defineExperiment } from "niceeval";
import * as niceevalSandbox from "niceeval/sandbox";
import diagnosisAgent from "../agents/canned-terminal-bench.ts";

const sandbox = niceevalSandbox as unknown as Record<string, unknown>;
const dockerImageSandbox = sandbox.dockerImageSandbox as ((options: { image: string }) => unknown) | undefined;
const dockerSandbox = sandbox.dockerSandbox as ((options: { image: string }) => unknown) | undefined;
const RUNTIME_IMAGE = "offline.invalid/niceeval-harness/runtime:node";

if (dockerImageSandbox === undefined && dockerSandbox === undefined) {
  throw new Error("installed niceeval lacks a Docker sandbox factory required by this fixture");
}

const runtimeSandbox = dockerImageSandbox !== undefined
  ? dockerImageSandbox({ image: RUNTIME_IMAGE })
  : dockerSandbox!({ image: RUNTIME_IMAGE });

export default defineExperiment({
  description: "Terminal-Bench task slice with one agent failure and one over-tight eval",
  agent: diagnosisAgent,
  sandbox: runtimeSandbox as never,
  evals: ["terminal-bench/"],
  attempts: 1,
  maxConcurrency: 1,
});
