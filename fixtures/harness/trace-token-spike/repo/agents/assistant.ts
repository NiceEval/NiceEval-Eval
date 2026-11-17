import { completeEvidenceCoverage, createSessionKey, defineAgent } from "niceeval/adapter";
import { setTimeout as sleep } from "node:timers/promises";

type Call = { name: string; input: Record<string, string | number>; output: string };
const state = createSessionKey<string>("assistant/state");

export default defineAgent({
  name: "trace-token-spike-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    let inputTokens = 1_000;
    if (input.text.startsWith("Knowledge:")) {
      const query = input.text.slice("Knowledge:".length).trim();
      const expanded = ctx.model === "candidate";
      calls = [{
        name: "search_kb",
        input: { query, topK: expanded ? "all" : 3 },
        output: JSON.stringify({ documents: Array.from({ length: expanded ? 180 : 3 }, (_, i) => ({
          id: `doc-${i + 1}`, text: `Knowledge base article ${i + 1}. ` + "Product documentation, account settings, delivery terms and troubleshooting. ".repeat(expanded ? 4 : 1),
        })) }),
      }];
      inputTokens = expanded ? 50_000 : 2_000;
      reply = "请参阅帮助中心文档了解操作步骤。[doc-1]";
    } else if (input.text.startsWith("Greeting")) {
      reply = "Hello! How can I help?";
    } else if (input.text.startsWith("Language")) {
      reply = "We support English and Chinese.";
    } else if (input.text.startsWith("Contact")) {
      reply = "Contact support@example.com.";
    }
    return {
      status: reply ? "completed" : "failed",
      usage: { inputTokens, outputTokens: 100 },
      events: [
        ...calls.flatMap((call, index) => [
          { type: "operation.started" as const, operationId: `op-${index}`, operation: { kind: "tool" as const, name: call.name, input: call.input } },
          { type: "operation.finished" as const, operationId: `op-${index}`, kind: "tool" as const, status: "completed" as const, output: call.output },
        ]),
        { type: "message" as const, role: "assistant" as const, text: reply },
      ],
    };
  },
});
