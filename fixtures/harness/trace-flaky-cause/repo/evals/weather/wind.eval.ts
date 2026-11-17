import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "wind",
  async test(t) {
    const turn = await t.send("Wind today?");
    turn.succeeded();
    t.check(turn.reply, includes("今天微风。"));
  },
});
