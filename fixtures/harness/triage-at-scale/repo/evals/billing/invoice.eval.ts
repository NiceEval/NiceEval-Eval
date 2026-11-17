import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "billing/invoice",
  async test(t) {
    const turn = await t.send("如何开具发票？");
    turn.succeeded();
    t.check(turn.reply, includes("电子发票"));
  },
});
