import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

// 客服机器人对五类问题的固定回答。
const ANSWERS: { prefix: string; reply: string }[] = [
  { prefix: "How long does a refund take", reply: "Refunds are returned to the original payment method within 7 days." },
  { prefix: "Where is my order", reply: "Your order has shipped; the tracking number is in your confirmation email." },
  { prefix: "I forgot my password", reply: "Use the reset link on the sign-in page; it expires in 30 minutes." },
  { prefix: "Do you ship to Canada", reply: "Yes, we ship to Canada; delivery takes 5 to 8 business days." },
  { prefix: "Cancel my subscription", reply: "Your subscription is cancelled and stays active until the end of the billing period." },
];

export default defineAgent({
  name: "support-bot",
  evidenceCoverage: completeEvidenceCoverage,
  send(input) {
    const answer = ANSWERS.find(({ prefix }) => input.text.startsWith(prefix));
    if (answer === undefined) {
      return { status: "failed", events: [{ type: "message", role: "assistant", text: "I do not know how to help with that." }] };
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: answer.reply }] };
  },
});
