import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "support/greeting-zh",
  async test(t) {
    const turn = await t.send("你好，我想咨询一下订单。");
    turn.succeeded();
    t.check(turn.reply, includes("您好"));
  },
});
