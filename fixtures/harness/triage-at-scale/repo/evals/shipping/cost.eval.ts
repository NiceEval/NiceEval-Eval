import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "shipping/cost",
  async test(t) {
    const turn = await t.send("运费多少？");
    turn.succeeded();
    t.check(turn.reply, includes("99 元"));
  },
});
