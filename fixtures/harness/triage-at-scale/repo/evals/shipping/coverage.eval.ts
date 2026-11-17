import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "shipping/coverage",
  async test(t) {
    const turn = await t.send("可以配送到哪里？");
    turn.succeeded();
    t.check(turn.reply, includes("中国大陆"));
  },
});
