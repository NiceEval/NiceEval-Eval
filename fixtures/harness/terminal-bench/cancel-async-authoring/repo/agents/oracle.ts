import { readFileSync } from "node:fs";
import * as niceevalAdapter from "niceeval/adapter";
import * as niceevalSandbox from "niceeval/sandbox";

const adapter = niceevalAdapter as unknown as Record<string, unknown>;
const sandbox = niceevalSandbox as unknown as Record<string, unknown>;
const defineSandboxAgent = adapter.defineSandboxAgent as ((definition: Record<string, unknown>) => unknown) | undefined;
const completeCoverage = adapter.completeEvidenceCoverage ?? adapter.completeCoverage;
const modernCoverage = adapter.completeEvidenceCoverage !== undefined;
const command = sandbox.command as ((executable: string, args: readonly string[]) => unknown) | undefined;
const solutionBase64 = readFileSync(new URL("../task/solution.sh", import.meta.url)).toString("base64");

if (defineSandboxAgent === undefined || completeCoverage === undefined || (modernCoverage && command === undefined)) {
  throw new Error("installed niceeval lacks the sandbox-agent compatibility surface required by this fixture");
}

type SandboxContext = {
  sandbox: {
    runShell(script: string, options?: { root?: boolean; user?: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
};

export default defineSandboxAgent({
  name: "cancel-async-oracle",
  ...(modernCoverage
    ? {
        evidenceCoverage: completeCoverage,
        ensure: {
          identity: { agent: "cancel-async-oracle", version: "1", revision: "1" },
          probe: command!("node", ["--version"]),
        },
      }
    : { coverage: completeCoverage }),
  async send(_input: { text: string }, ctx: SandboxContext) {
    const run = await ctx.sandbox.runShell(
      `printf '%s' '${solutionBase64}' | base64 -d > /tmp/cancel-async-solution.sh
chmod +x /tmp/cancel-async-solution.sh
cd /app
bash /tmp/cancel-async-solution.sh`,
      { root: true, user: "root" },
    );

    if (run.exitCode !== 0) {
      return {
        status: "failed",
        events: [{ type: "message", role: "assistant", text: run.stderr || run.stdout || "oracle failed" }],
      };
    }

    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "Implemented the official reference behavior in /app/run.py." }],
    };
  },
}) as never;
