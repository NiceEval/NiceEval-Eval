import { readFileSync } from "node:fs";
import * as niceevalAdapter from "niceeval/adapter";
import * as niceevalSandbox from "niceeval/sandbox";

const adapter = niceevalAdapter as unknown as Record<string, unknown>;
const sandbox = niceevalSandbox as unknown as Record<string, unknown>;
const defineSandboxAgent = adapter.defineSandboxAgent as ((definition: Record<string, unknown>) => unknown) | undefined;
const completeCoverage = adapter.completeEvidenceCoverage ?? adapter.completeCoverage;
const modernCoverage = adapter.completeEvidenceCoverage !== undefined;
const command = sandbox.command as ((executable: string, args: readonly string[]) => unknown) | undefined;
const classifierCodeBase64 = readFileSync(new URL("../tasks/classifier-debug/code.py", import.meta.url)).toString("base64");
const applicationLogBase64 = readFileSync(new URL("../tasks/log-summary/log-data/application.txt", import.meta.url)).toString("base64");
const workerLogBase64 = readFileSync(new URL("../tasks/log-summary/log-data/worker.txt", import.meta.url)).toString("base64");

if (defineSandboxAgent === undefined || completeCoverage === undefined || (modernCoverage && command === undefined)) {
  throw new Error("installed niceeval lacks the sandbox-agent compatibility surface required by this fixture");
}

type SandboxContext = {
  sandbox: {
    runShell(script: string, options?: { root?: boolean; user?: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
};

export default defineSandboxAgent({
  name: "terminal-bench-canned-triage",
  ...(modernCoverage
    ? {
        evidenceCoverage: completeCoverage,
        ensure: {
          identity: { agent: "terminal-bench-canned-triage", version: "1", revision: "1" },
          probe: command!("node", ["--version"]),
        },
      }
    : { coverage: completeCoverage }),
  async send(input: { text: string }, ctx: SandboxContext) {
    let script: string | undefined;
    let message: string;

    if (input.text.startsWith("Create a file called /app/hello.txt")) {
      script = "mkdir -p /app && printf '%s\\n' 'Hello, world!' > /app/hello.txt";
      message = "Created /app/hello.txt with the requested greeting.";
    } else if (input.text.startsWith("Consider the following neural network training code")) {
      script = `mkdir -p /app
printf '%s' '${classifierCodeBase64}' | base64 -d > /app/code.py
printf '%s\\n' 'B' > /app/answer.txt`;
      message = "Selected option B and wrote it to /app/answer.txt.";
    } else if (input.text.startsWith("In /app/logs there are multiple .log files")) {
      script = String.raw`mkdir -p /app/logs
printf '%s' '${applicationLogBase64}' | base64 -d > /app/logs/application.log
printf '%s' '${workerLogBase64}' | base64 -d > /app/logs/worker.log
error_count=$(grep -h "ERROR" /app/logs/*.log | wc -l)
warning_count=$(grep -h "WARNING" /app/logs/*.log | wc -l)
info_count=$(grep -h "INFO" /app/logs/*.log | wc -l)
printf '"severity","count"\n"ERROR","%s"\n"WARNING","%s"\n"INFO","%s"\n' "$error_count" "$warning_count" "$info_count" > /app/summary.csv
cat /app/summary.csv`;
      message = "Created a valid CSV summary with quoted fields.";
    } else {
      return {
        status: "failed",
        events: [{ type: "message", role: "assistant", text: "No canned Terminal-Bench action is available." }],
      };
    }

    const run = await ctx.sandbox.runShell(script, { root: true, user: "root" });
    if (run.exitCode !== 0) {
      return {
        status: "failed",
        events: [{ type: "message", role: "assistant", text: run.stderr || run.stdout || "canned action failed" }],
      };
    }

    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: `${message}${run.stdout.trim() ? `\n${run.stdout.trim()}` : ""}` }],
    };
  },
}) as never;
