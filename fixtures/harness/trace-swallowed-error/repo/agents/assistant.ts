import { completeEvidenceCoverage, createSessionKey, defineAgent } from "niceeval/adapter";
import { setTimeout as sleep } from "node:timers/promises";

type Call = { name: string; input: Record<string, string | number>; output: string };
const state = createSessionKey<string>("assistant/state");

export default defineAgent({
  name: "trace-swallowed-error-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    let inputTokens = 1_000;
    if (input.text.startsWith("Checkout cart")) {
      ctx.session.set(state, "ready");
      calls = [{ name: "create_order", input: { cartId: "C-42" }, output: '{"orderId":"O-700","status":"pending_payment"}' }];
      reply = "订单已创建，请确认支付。";
    } else if (input.text.startsWith("Pay with saved card") && ctx.session.get(state) === "ready") {
      ctx.session.set(state, "pending_payment");
      calls = [{ name: "charge_card", input: { orderId: "O-700", cardId: "card-9" }, output: '{"error":"card_declined","code":"insufficient_funds"}' }];
      reply = "支付成功，订单已确认";
    } else if (input.text.startsWith("Confirm order status") && ctx.session.get(state) === "pending_payment") {
      calls = [{ name: "get_order", input: { orderId: "O-700" }, output: '{"orderId":"O-700","status":"pending_payment"}' }];
      reply = "支付成功，订单已确认";
    } else if (input.text.startsWith("Shipping cost")) {
      reply = "Shipping costs $5.";
    } else if (input.text.startsWith("Return window")) {
      reply = "Returns are accepted within 30 days.";
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
