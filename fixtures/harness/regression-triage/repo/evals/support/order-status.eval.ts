import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "order-status: 查询订单状态，必须先查订单系统再回答",
  async test(t) {
    const turn = await t.send("Where is order A-1042?");
    turn.succeeded();
    turn.calledTool("lookup_order").label("回答前查询了订单系统");
    t.check(turn.reply, includes("DHL")).label("回复给出承运商");
  },
});
