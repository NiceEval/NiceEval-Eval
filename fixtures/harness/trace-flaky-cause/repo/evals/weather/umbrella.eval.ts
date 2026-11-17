import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "umbrella",
  async test(t) {
    const turn = await t.send("Umbrella today?");
    turn.succeeded();
    t.check(turn.reply, includes("记得带伞"));
  },
});
