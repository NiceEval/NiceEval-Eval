import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "account/password-reset",
  async test(t) {
    const turn = await t.send("怎么重置密码？");
    turn.succeeded();
    t.check(turn.reply, includes("重置密码链接"));
  },
});
