import { readFileSync } from "node:fs";
import * as niceevalAdapter from "niceeval/adapter";
import * as niceevalSandbox from "niceeval/sandbox";

const adapter = niceevalAdapter as unknown as Record<string, unknown>;
const sandbox = niceevalSandbox as unknown as Record<string, unknown>;
const defineSandboxAgent = adapter.defineSandboxAgent as ((definition: Record<string, unknown>) => unknown) | undefined;
const completeCoverage = adapter.completeEvidenceCoverage ?? adapter.completeCoverage;
const modernCoverage = adapter.completeEvidenceCoverage !== undefined;
const command = sandbox.command as ((executable: string, args: readonly string[]) => unknown) | undefined;
const processDataBase64 = readFileSync(new URL("../tasks/fix-permissions/process_data.sh", import.meta.url)).toString("base64");
const classifierCodeBase64 = readFileSync(new URL("../tasks/classifier-debug/code.py", import.meta.url)).toString("base64");

if (defineSandboxAgent === undefined || completeCoverage === undefined || (modernCoverage && command === undefined)) {
  throw new Error("installed niceeval lacks the sandbox-agent compatibility surface required by this fixture");
}

type SandboxContext = {
  sandbox: {
    runShell(script: string, options?: { root?: boolean; user?: string }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
};

export default defineSandboxAgent({
  name: "terminal-bench-canned-runtime",
  ...(modernCoverage
    ? {
        evidenceCoverage: completeCoverage,
        ensure: {
          identity: { agent: "terminal-bench-canned-runtime", version: "1", revision: "1" },
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
    } else if (input.text.startsWith("A script called '/app/process_data.sh'")) {
      script = `mkdir -p /app
printf '%s' '${processDataBase64}' | base64 -d > /app/process_data.sh
chmod -x /app/process_data.sh
chmod +x /app/process_data.sh
/app/process_data.sh`;
      message = "Made /app/process_data.sh executable and ran it successfully.";
    } else if (input.text.startsWith("Consider the following neural network training code")) {
      script = `mkdir -p /app
printf '%s' '${classifierCodeBase64}' | base64 -d > /app/code.py
printf '%s\\n' 'B' > /app/answer.txt`;
      message = "Selected option B and wrote it to /app/answer.txt.";
    } else if (input.text.startsWith("Write a regex expression that matches dates")) {
      script = String.raw`mkdir -p /app
cat > /app/regex.txt <<'REGEX_EOF'
(?=.*(?:^|[^0-9A-Za-z])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?=$|[^0-9A-Za-z])).*(?:^|[^0-9A-Za-z])(\d{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12]\d|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-9])))(?=$|[^0-9A-Za-z])
REGEX_EOF`;
      message = "Wrote the requested IPv4-aware date expression to /app/regex.txt.";
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
      events: [{ type: "message", role: "assistant", text: message }],
    };
  },
}) as never;
