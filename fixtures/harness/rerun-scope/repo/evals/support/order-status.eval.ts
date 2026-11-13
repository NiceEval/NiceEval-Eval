import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "order-status: 查询订单状态",
  async test(t) {
    const turn = await t.send("Where is my order?");
    turn.succeeded();
    t.check(turn.reply, includes("tracking number"));
  },
});
