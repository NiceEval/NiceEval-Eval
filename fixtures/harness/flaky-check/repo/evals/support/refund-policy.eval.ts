import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "refund-policy: 退款政策",
  async test(t) {
    const turn = await t.send("What is your refund policy?");
    turn.succeeded();
    t.check(turn.reply, includes("30 days"));
  },
});
