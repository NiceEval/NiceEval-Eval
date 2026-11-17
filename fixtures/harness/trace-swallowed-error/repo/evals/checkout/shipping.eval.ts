import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "checkout/shipping",
  async test(t) {
    const turn = await t.send("Shipping cost?");
    turn.succeeded();
    t.check(turn.reply, includes("$5"));
  },
});
