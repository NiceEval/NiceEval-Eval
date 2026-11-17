import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "account/email-change",
  async test(t) {
    const turn = await t.send("如何修改邮箱？");
    turn.succeeded();
    t.check(turn.reply, includes("验证新邮箱"));
  },
});
