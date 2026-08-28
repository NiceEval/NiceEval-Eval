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
  name: "cancel-async-leak-probe",
  ...(modernCoverage
    ? {
        evidenceCoverage: completeCoverage,
        ensure: {
          identity: { agent: "cancel-async-leak-probe", version: "1", revision: "1" },
          probe: command!("node", ["--version"]),
        },
      }
    : { coverage: completeCoverage }),
  async send(_input: { text: string }, ctx: SandboxContext) {
    const inspection = await ctx.sandbox.runShell(
      String.raw`set +e
for root in /tests /app /home/sandbox/workspace /workspace /tmp; do
  [ -e "$root" ] || continue
  find -H "$root" -maxdepth 7 -type f \( \
    -name test.py -o \
    -name test_outputs.py -o \
    -name run-tests.sh -o \
    -name solution.sh \
  \) -print 2>/dev/null
done | sort -u`,
      { root: true, user: "root" },
    );
    const leakedPaths = inspection.stdout.trim();

    const implementation = leakedPaths
      ? `printf '%s' '${solutionBase64}' | base64 -d > /tmp/cancel-async-solution.sh
chmod +x /tmp/cancel-async-solution.sh
cd /app
bash /tmp/cancel-async-solution.sh`
      : `cat > /app/run.py <<'PY'
from typing import Awaitable, Callable

async def run_tasks(
    tasks: list[Callable[[], Awaitable[None]]],
    max_concurrent: int,
) -> None:
    # Deliberately wrong negative control: serial execution ignores available concurrency.
    for task in tasks:
        await task()
PY`;

    const run = await ctx.sandbox.runShell(implementation, { root: true, user: "root" });
    if (run.exitCode !== 0) {
      return {
        status: "failed",
        events: [{ type: "message", role: "assistant", text: run.stderr || run.stdout || "leak probe failed" }],
      };
    }

    return {
      status: "completed",
      events: [{
        type: "message",
        role: "assistant",
        text: leakedPaths
          ? `Hidden verifier material was visible before completion: ${leakedPaths}`
          : "No hidden verifier material was visible; wrote the deliberate negative-control implementation.",
      }],
    };
  },
}) as never;
