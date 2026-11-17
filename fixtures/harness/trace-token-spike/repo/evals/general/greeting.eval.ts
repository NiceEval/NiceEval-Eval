import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "general/greeting",
  async test(t) {
    const turn = await t.send("Greeting");
    turn.succeeded();
    t.check(turn.reply, includes("Hello"));
  },
});
