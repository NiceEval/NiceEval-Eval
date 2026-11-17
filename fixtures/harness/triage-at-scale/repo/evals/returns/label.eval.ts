import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "returns/label",
  async test(t) {
    const turn = await t.send("请为订单 A-42 生成退货标签。");
    turn.succeeded();
    t.check(turn.reply, includes("https://returns.example/A-42.pdf"));
  },
});
