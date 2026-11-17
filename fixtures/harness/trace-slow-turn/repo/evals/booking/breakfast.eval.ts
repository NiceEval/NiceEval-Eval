import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "booking/breakfast",
  async test(t) {
    const turn = await t.send("Breakfast hours?");
    turn.succeeded();
    t.check(turn.reply, includes("7 to 10"));
  },
});
