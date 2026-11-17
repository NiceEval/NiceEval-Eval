import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "order-status",
  async test(t) {
    const turn = await t.send("Order status A-1002.");
    turn.succeeded();
    t.check(turn.reply, includes("订单正在配送。"));
  },
});
