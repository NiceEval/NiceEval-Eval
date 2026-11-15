import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "cancel: 取消订阅",
  async test(t) {
    const turn = await t.send("Cancel my subscription.");
    turn.succeeded();
    t.check(turn.reply, includes("end of the billing period"));
  },
});
