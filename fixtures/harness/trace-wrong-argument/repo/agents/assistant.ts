import { completeEvidenceCoverage, createSessionKey, defineAgent } from "niceeval/adapter";
import { setTimeout as sleep } from "node:timers/promises";

type Call = { name: string; input: Record<string, string | number>; output: string };
const state = createSessionKey<string>("assistant/state");

export default defineAgent({
  name: "trace-wrong-argument-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    let inputTokens = 1_000;
    if (input.text.startsWith("Cancel order")) {
      calls = [
        { name: "lookup_orders", input: { customerId: "C-17" }, output: JSON.stringify([{ orderId: "A-1001", status: "delivered", createdAt: "2026-11-01" }, { orderId: "A-1002", status: "awaiting_shipment", createdAt: "2026-11-16" }]) },
        { name: "cancel_order", input: { orderId: "A-1001" }, output: '{"orderId":"A-1001","status":"cancelled"}' },
      ];
      reply = "已为您取消订单 A-1002";
    } else if (input.text.startsWith("Gift wrapping")) {
      reply = "Gift wrapping costs $4.";
    } else if (input.text.startsWith("Reset password")) {
      reply = "Use the reset link on the sign-in page.";
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
