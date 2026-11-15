import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "password-reset: 重置密码",
  async test(t) {
    const turn = await t.send("I forgot my password.");
    turn.succeeded();
    t.check(turn.reply, includes("reset link"));
  },
});
