import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "support/gift-wrapping",
  async test(t) {
    const turn = await t.send("Gift wrapping price?");
    turn.succeeded();
    t.check(turn.reply, includes("$4"));
  },
});
