import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "catalog/stock",
  async test(t) {
    const turn = await t.send("商品 S-1 有库存吗？");
    turn.succeeded();
    t.check(turn.reply, includes("有库存"));
  },
});
