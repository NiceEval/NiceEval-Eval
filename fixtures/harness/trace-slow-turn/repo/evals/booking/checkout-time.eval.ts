import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "booking/checkout-time",
  async test(t) {
    const turn = await t.send("Checkout time?");
    turn.succeeded();
    t.check(turn.reply, includes("11 am"));
  },
});
