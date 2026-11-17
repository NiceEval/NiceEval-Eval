import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "returns/exchange",
  async test(t) {
    const turn = await t.send("可以换货吗？");
    turn.succeeded();
    t.check(turn.reply, includes("更换尺码"));
  },
});
