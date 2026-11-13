import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "refund-policy: 说明退款政策，必须给出 30 天期限",
  async test(t) {
    const turn = await t.send("What is your refund policy?");
    turn.succeeded();
    t.check(turn.reply, includes("30 days")).label("给出 30 天退货期限");
    t.check(turn.reply, includes("original payment method")).label("说明退回原支付方式");
  },
});
