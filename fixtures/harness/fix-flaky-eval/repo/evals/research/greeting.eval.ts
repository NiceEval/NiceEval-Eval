import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "研究助手打招呼",
  async test(t) {
    const turn = await t.send("你好");
    turn.succeeded();
    t.check(turn.reply, includes("研究助手"));
  },
});
