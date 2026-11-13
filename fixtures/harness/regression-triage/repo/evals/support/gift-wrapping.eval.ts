import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "gift-wrapping: 礼品包装的价格",
  async test(t) {
    const turn = await t.send("Do you offer gift wrapping?");
    turn.succeeded();
    t.check(turn.reply, includes("$4")).label("给出价格");
  },
});
