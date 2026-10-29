// log-summary-repair 的外层探针：只在 agent 收工后临时替换 repo/agents/canned-terminal-bench.ts，
// 用 HARNESS_CSV_PROBE 选择 log-summary 的产物，检验 agent 改后的 Eval 是否既不过紧也不放水。
// 不设 HARNESS_CSV_PROBE 时与原 canned agent 产出相同。不进 agent 工作区。
import { readFileSync } from "node:fs";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { command } from "niceeval/sandbox";

const classifierCodeBase64 = readFileSync(new URL("../tasks/classifier-debug/code.py", import.meta.url)).toString("base64");
const applicationLogBase64 = readFileSync(new URL("../tasks/log-summary/log-data/application.txt", import.meta.url)).toString("base64");
const workerLogBase64 = readFileSync(new URL("../tasks/log-summary/log-data/worker.txt", import.meta.url)).toString("base64");

/** 探针名 → 写入 /app/summary.csv 的字节；null 表示不写文件。 */
const PROBES: Record<string, string | null> = {
  "plain": "severity,count\nERROR,4\nWARNING,3\nINFO,8\n",
  "crlf-quoted": '"severity","count"\r\n"ERROR","4"\r\n"WARNING","3"\r\n"INFO","8"\r\n',
  "wrong-count": "severity,count\nERROR,5\nWARNING,3\nINFO,8\n",
  "missing-row": "severity,count\nERROR,4\nWARNING,3\n",
  "extra-row": "severity,count\nERROR,4\nWARNING,3\nINFO,8\nDEBUG,0\n",
  "no-header": "ERROR,4\nWARNING,3\nINFO,8\n",
  "missing-file": null,
};

function logSummaryScript(): string {
  const setup = String.raw`mkdir -p /app/logs
printf '%s' '${applicationLogBase64}' | base64 -d > /app/logs/application.log
printf '%s' '${workerLogBase64}' | base64 -d > /app/logs/worker.log
rm -f /app/summary.csv`;
  const probe = process.env.HARNESS_CSV_PROBE;
  if (probe === undefined || probe === "") {
    return String.raw`${setup}
error_count=$(grep -h "ERROR" /app/logs/*.log | wc -l)
warning_count=$(grep -h "WARNING" /app/logs/*.log | wc -l)
info_count=$(grep -h "INFO" /app/logs/*.log | wc -l)
printf '"severity","count"\n"ERROR","%s"\n"WARNING","%s"\n"INFO","%s"\n' "$error_count" "$warning_count" "$info_count" > /app/summary.csv
cat /app/summary.csv`;
  }
  if (!(probe in PROBES)) throw new Error(`未知的 HARNESS_CSV_PROBE：${probe}`);
  const csv = PROBES[probe];
  if (csv === null) return setup;
  return `${setup}\nprintf '%s' '${Buffer.from(csv).toString("base64")}' | base64 -d > /app/summary.csv`;
}

export default defineSandboxAgent({
  name: "terminal-bench-canned-triage",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "terminal-bench-canned-triage", version: "1", revision: "1" },
    probe: command("node", ["--version"]),
  },
  async send(input, ctx) {
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
      script = logSummaryScript();
      message = "Wrote the log summary.";
    } else {
      return {
        status: "failed",
        events: [{ type: "message", role: "assistant", text: "No canned Terminal-Bench action is available." }],
      };
    }

    const run = await ctx.sandbox.runShell(script, { user: "root" });
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
});
