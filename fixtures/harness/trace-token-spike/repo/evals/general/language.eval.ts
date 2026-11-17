import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "general/language",
  async test(t) {
    const turn = await t.send("Language options?");
    turn.succeeded();
    t.check(turn.reply, includes("English and Chinese"));
  },
});
