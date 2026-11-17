import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "returns/address",
  async test(t) {
    const turn = await t.send("退货寄到哪里？");
    turn.succeeded();
    t.check(turn.reply, includes("标签上的仓库地址"));
  },
});
