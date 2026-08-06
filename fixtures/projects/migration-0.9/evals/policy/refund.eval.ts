import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "refund policy returns the documented 30-day window",
  async test(t) {
    await t.send("What is the refund window?");
    t.check(t.reply, includes("30 days"));
  },
});
