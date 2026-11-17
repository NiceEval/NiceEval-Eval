import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "billing/refund-status",
  async test(t) {
    const turn = await t.send("退款多久到账？");
    turn.succeeded();
    t.check(turn.reply, includes("3 个工作日"));
  },
});
