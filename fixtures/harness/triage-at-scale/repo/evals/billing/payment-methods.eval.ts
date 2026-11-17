import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "billing/payment-methods",
  async test(t) {
    const turn = await t.send("支持哪些付款方式？");
    turn.succeeded();
    t.check(turn.reply, includes("支付宝"));
  },
});
