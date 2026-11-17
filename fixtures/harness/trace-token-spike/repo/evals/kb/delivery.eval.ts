import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "kb/delivery",
  async test(t) {
    const turn = await t.send("Knowledge: delivery policy");
    turn.succeeded();
    t.check(turn.reply, includes("[doc-1]"));
  },
});
