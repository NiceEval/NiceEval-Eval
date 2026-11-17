import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "refund-window",
  async test(t) {
    const turn = await t.send("Refund window?");
    turn.succeeded();
    t.check(turn.reply, includes("退款期限为 30 天。"));
  },
});
