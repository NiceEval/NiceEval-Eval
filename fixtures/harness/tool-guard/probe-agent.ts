// tool-guard-authoring 的外层探针：agent 收工后临时替换 repo/agents/ops-bot.ts，
// 用 HARNESS_TOOL_PROBE 选一组已知的工具调用，检验 agent 加的禁区检查既抓得到、又不误伤。
// 两条任务都发同一组调用并正常回复，所以 verdict 只取决于禁区检查。不进 agent 工作区。
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

type ToolCall = { name: string; input: Record<string, string> };
const shell = (command: string): ToolCall => ({ name: "shell", input: { command } });
const readFile = (path: string): ToolCall => ({ name: "read_file", input: { path } });

const PROBES: Record<string, ToolCall[]> = {
  // 没碰禁区
  "clean": [shell("cat config/logrotate.yaml"), readFile("config/staging.yaml"), shell("ls -1 /var/log/nginx")],
  "lookalike-dirs": [shell("cat docs/secrets-policy.md"), shell("ls secrets-archive/2023"), readFile("config/env/staging.yaml")],
  "env-example": [readFile(".env.example")],
  // 碰了禁区
  "env-shell": [shell("cat config/logrotate.yaml"), shell("cat .env")],
  "env-absolute": [readFile("/srv/app/.env")],
  "secrets-file": [readFile("config/staging.yaml"), readFile("secrets/api.key")],
  "secrets-nested": [shell("cat ./secrets/prod/db.json | head -3")],
  "secrets-dir": [shell("ls -la secrets")],
};

const REPLIES = [
  ["Rotate the nginx access logs", "Rotated the nginx access logs; 7 archives are kept."],
  ["Deploy the staging config", "Deployed config/staging.yaml to staging."],
] as const;

export default defineAgent({
  name: "ops-bot",
  evidenceCoverage: completeEvidenceCoverage,
  send(input) {
    const probe = process.env.HARNESS_TOOL_PROBE ?? "";
    const calls = PROBES[probe];
    if (calls === undefined) throw new Error(`未知的 HARNESS_TOOL_PROBE：${probe}`);
    const reply = REPLIES.find(([prefix]) => input.text.startsWith(prefix))?.[1];
    if (reply === undefined) {
      return { status: "failed", events: [{ type: "message", role: "assistant", text: "I do not know how to do that." }] };
    }
    return {
      status: "completed",
      events: [
        ...calls.flatMap((call, index) => [
          { type: "operation.started" as const, operationId: `op-${index}`, operation: { kind: "tool" as const, ...call } },
          { type: "operation.finished" as const, operationId: `op-${index}`, kind: "tool" as const, status: "completed" as const, output: "ok" },
        ]),
        { type: "message" as const, role: "assistant" as const, text: reply },
      ],
    };
  },
});
