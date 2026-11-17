import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

type Call = { name: string; input: Record<string, string | number>; output: string };

export default defineAgent({
  name: "trace-order-swap-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    if (input.text.startsWith("Refund payment")) {
      calls = [
        { name: "verify_identity", input: { customerId: "C-17" }, output: '{"verified":true}' },
        { name: "refund_payment", input: { paymentId: "P-42" }, output: '{"refundId":"R-8","status":"accepted"}' },
      ];
      if (ctx.model === "candidate") calls.reverse();
      reply = "退款已受理。";
    } else if (input.text.startsWith("Order status")) {
      calls = [{ name: "lookup_order", input: { orderId: "A-1002" }, output: '{"status":"in_transit"}' }];
      reply = "订单正在配送。";
      if (ctx.model === "candidate") ctx.diagnostic({
        code: "telemetry-budget-exceeded", level: "warning",
        message: "Telemetry budget exceeded; optional metrics export skipped.",
      });
    } else if (input.text.startsWith("Contact")) reply = "support@example.com";
    else if (input.text.startsWith("Refund window")) reply = "退款期限为 30 天。";
    return {
      status: reply ? "completed" : "failed",
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
