import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "refund policy returns the documented 30-day window",
  tags: ["harness-policy", "policy"],
  async test(t) {
    const turn = await t.send("What is the refund window?");
    turn.succeeded();
    t.check(t.reply, includes("30 days"));
  },
});
