import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "password-reset: 重置密码的入口",
  async test(t) {
    const turn = await t.send("How do I reset my password?");
    turn.succeeded();
    t.check(turn.reply, includes("reset link")).label("指向重置链接");
  },
});
