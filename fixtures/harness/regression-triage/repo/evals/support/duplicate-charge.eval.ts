import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "duplicate-charge: 重复扣款必须建工单，不能让用户自己等",
  async test(t) {
    const turn = await t.send("I was charged twice for the same order.");
    turn.succeeded();
    turn.calledTool("open_ticket").label("为重复扣款建了工单");
    t.check(turn.reply, includes("ticket")).label("回复给出工单号");
  },
});
