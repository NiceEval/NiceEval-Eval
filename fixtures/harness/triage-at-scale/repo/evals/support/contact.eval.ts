import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "support/contact",
  async test(t) {
    const turn = await t.send("如何联系客服？");
    turn.succeeded();
    t.check(turn.reply, includes("support@example.com"));
  },
});
