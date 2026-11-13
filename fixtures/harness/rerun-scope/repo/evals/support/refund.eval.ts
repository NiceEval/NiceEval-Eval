import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "refund: 退款时效",
  async test(t) {
    const turn = await t.send("How long does a refund take?");
    turn.succeeded();
    t.check(turn.reply, includes("within 7 days"));
  },
});
