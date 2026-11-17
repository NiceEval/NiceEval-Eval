import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "catalog/compare",
  async test(t) {
    const turn = await t.send("比较商品 S-1 与 S-2 的重量。");
    turn.succeeded();
    t.check(turn.reply, includes("S-1 比 S-2 轻 100 克"));
  },
});
