import { defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "legacy-policy-agent",
  async send(input) {
    return {
      status: "completed",
      events: [
        {
          type: "message",
          role: "assistant",
          text: /refund|return/i.test(input.text)
            ? "Customers may request a refund within 30 days of purchase."
            : "I do not have that policy information.",
        },
      ],
    };
  },
});
