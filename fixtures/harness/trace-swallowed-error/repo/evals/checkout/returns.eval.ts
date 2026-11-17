import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "checkout/returns",
  async test(t) {
    const turn = await t.send("Return window?");
    turn.succeeded();
    t.check(turn.reply, includes("30 days"));
  },
});
