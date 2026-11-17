import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "kb/troubleshooting",
  async test(t) {
    const turn = await t.send("Knowledge: troubleshooting");
    turn.succeeded();
    t.check(turn.reply, includes("[doc-1]"));
  },
});
