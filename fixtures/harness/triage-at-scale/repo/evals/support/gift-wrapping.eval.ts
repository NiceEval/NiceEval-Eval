import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "support/gift-wrapping",
  async test(t) {
    const turn = await t.send("有礼品包装吗？");
    turn.succeeded();
    t.check(turn.reply, includes("礼品包装"));
  },
});
