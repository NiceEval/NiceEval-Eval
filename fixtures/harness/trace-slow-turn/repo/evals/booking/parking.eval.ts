import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "booking/parking",
  async test(t) {
    const turn = await t.send("Parking cost?");
    turn.succeeded();
    t.check(turn.reply, includes("free"));
  },
});
