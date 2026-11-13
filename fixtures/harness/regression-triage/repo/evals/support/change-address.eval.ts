import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "change-address: 改地址只能在发货前，回答必须说明这个限制",
  async test(t) {
    const turn = await t.send("Can I change my delivery address?");
    turn.succeeded();
    t.check(turn.reply, includes("before the order ships")).label("说明只能在发货前修改");
  },
});
