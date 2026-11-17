import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "support/password-reset",
  async test(t) {
    const turn = await t.send("Reset password instructions?");
    turn.succeeded();
    t.check(turn.reply, includes("reset link"));
  },
});
