import { readFileSync } from "node:fs";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { command } from "niceeval/sandbox";

const solutionBase64 = readFileSync(new URL("../task/solution.sh", import.meta.url)).toString("base64");

export default defineSandboxAgent({
  name: "cancel-async-oracle",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "cancel-async-oracle", version: "1", revision: "1" },
    probe: command("node", ["--version"]),
  },
  async send(_input, ctx) {
    const run = await ctx.sandbox.runShell(
      `printf '%s' '${solutionBase64}' | base64 -d > /tmp/cancel-async-solution.sh
chmod +x /tmp/cancel-async-solution.sh
cd /app
bash /tmp/cancel-async-solution.sh`,
      { user: "root" },
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
});
