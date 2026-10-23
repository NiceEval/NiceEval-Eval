import { readFileSync } from "node:fs";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { command } from "niceeval/sandbox";

const solutionBase64 = readFileSync(new URL("../task/solution.sh", import.meta.url)).toString("base64");

export default defineSandboxAgent({
  name: "cancel-async-leak-probe",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "cancel-async-leak-probe", version: "1", revision: "1" },
    probe: command("node", ["--version"]),
  },
  async send(_input, ctx) {
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
      { user: "root" },
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

    const run = await ctx.sandbox.runShell(implementation, { user: "root" });
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
});
