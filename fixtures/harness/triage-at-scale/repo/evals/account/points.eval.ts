import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "account/points",
  async test(t) {
    const turn = await t.send("查看积分。");
    turn.succeeded();
    t.check(turn.reply, includes("100"));
  },
});
