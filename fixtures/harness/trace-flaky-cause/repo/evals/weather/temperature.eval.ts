import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "temperature",
  async test(t) {
    const turn = await t.send("Temperature today?");
    turn.succeeded();
    t.check(turn.reply, includes("今天 22 度。"));
  },
});
