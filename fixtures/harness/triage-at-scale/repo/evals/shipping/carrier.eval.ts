import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "shipping/carrier",
  async test(t) {
    const turn = await t.send("用什么快递？");
    turn.succeeded();
    t.check(turn.reply, includes("顺丰"));
  },
});
