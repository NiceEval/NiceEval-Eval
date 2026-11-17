import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "returns/window",
  async test(t) {
    const turn = await t.send("退货期限是多久？");
    turn.succeeded();
    t.check(turn.reply, includes("30 天"));
  },
});
