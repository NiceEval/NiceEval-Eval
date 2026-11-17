import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "kb/account",
  async test(t) {
    const turn = await t.send("Knowledge: account settings");
    turn.succeeded();
    t.check(turn.reply, includes("[doc-1]"));
  },
});
