import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "catalog/search",
  async test(t) {
    const turn = await t.send("搜索红色运动鞋，只要红色。");
    turn.succeeded();
    t.check(turn.reply, includes("红色运动鞋"));
  },
});
