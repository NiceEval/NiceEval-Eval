import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

type ToolCall = { name: string; input: Record<string, string>; output: string };
type Answer = { calls: ToolCall[]; reply: string };

// 两个模型对六类问题的实际表现：发起了哪些工具调用、最后怎么回答。
const BEHAVIOR: Record<string, Record<"atlas-1" | "atlas-2", Answer>> = {
  "What is your refund policy": {
    "atlas-1": { calls: [], reply: "You can return any item within 30 days of delivery for a full refund to the original payment method." },
    "atlas-2": { calls: [], reply: "You can return items for a full refund to the original payment method. Let me know if you need a return label." },
  },
  "Where is order": {
    "atlas-1": {
      calls: [{ name: "lookup_order", input: { orderId: "A-1042" }, output: '{"status":"shipped","carrier":"DHL","eta":"2 days"}' }],
      reply: "Order A-1042 has shipped with DHL and should arrive in 2 days.",
    },
    "atlas-2": { calls: [], reply: "Order A-1042 has shipped with DHL and should arrive in 2 days." },
  },
  "I was charged twice": {
    "atlas-1": { calls: [], reply: "Sorry about that. Duplicate charges usually drop off on their own within a few days." },
    "atlas-2": {
      calls: [{ name: "open_ticket", input: { category: "billing", summary: "duplicate charge" }, output: '{"ticket":"T-7781"}' }],
      reply: "Sorry about that. I opened billing ticket T-7781; the duplicate charge will be reversed within 3 business days.",
    },
  },
  "Can I change my delivery address": {
    "atlas-1": { calls: [], reply: "Yes, you can change the address any time from your account page." },
    "atlas-2": { calls: [], reply: "Yes, you can update the address from your account page whenever you like." },
  },
  "Do you offer gift wrapping": {
    "atlas-1": { calls: [], reply: "Yes, gift wrapping is available at checkout for $4 per item." },
    "atlas-2": { calls: [], reply: "Yes, gift wrapping is available at checkout for $4 per item." },
  },
  "How do I reset my password": {
    "atlas-1": { calls: [], reply: "Use the reset link on the sign-in page; it expires in 30 minutes." },
    "atlas-2": { calls: [], reply: "Use the reset link on the sign-in page; it expires in 30 minutes." },
  },
};

export default defineAgent({
  name: "support-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  send(input, ctx) {
    const model = ctx.model === "atlas-2" ? "atlas-2" : "atlas-1";
    const answer = Object.entries(BEHAVIOR).find(([prefix]) => input.text.startsWith(prefix))?.[1][model];
    if (answer === undefined) {
      return { status: "failed", events: [{ type: "message", role: "assistant", text: "I do not know how to help with that." }] };
    }
    return {
      status: "completed",
      events: [
        ...answer.calls.flatMap((call, index) => [
          { type: "operation.started" as const, operationId: `op-${index}`, operation: { kind: "tool" as const, name: call.name, input: call.input } },
          { type: "operation.finished" as const, operationId: `op-${index}`, kind: "tool" as const, status: "completed" as const, output: call.output },
        ]),
        { type: "message" as const, role: "assistant" as const, text: answer.reply },
      ],
    };
  },
});
