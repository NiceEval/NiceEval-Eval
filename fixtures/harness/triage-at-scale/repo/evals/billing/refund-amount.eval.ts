import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "billing/refund-amount",
  async test(t) {
    const turn = await t.send("订单 A-42 全额退款能退多少钱？");
    turn.succeeded();
    t.check(turn.reply, includes("49.99 元"));
  },
});
