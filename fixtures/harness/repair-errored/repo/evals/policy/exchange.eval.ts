import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "exchange policy returns the documented 14-day window",
  tags: ["harness-policy", "policy"],
  async test(t) {
    const turn = await t.send("How long do I have to exchange an item?");
    turn.succeeded();
    t.check(t.reply, includes("14 days"));
  },
});
