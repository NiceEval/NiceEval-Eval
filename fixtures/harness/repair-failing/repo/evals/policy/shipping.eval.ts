import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "shipping policy states the standard business-day window",
  tags: ["harness-policy", "policy"],
  async test(t) {
    const turn = await t.send("How fast is shipping?");
    turn.succeeded();
    t.check(t.reply, includes("business days"));
  },
});
