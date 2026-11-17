import { defineEval } from "niceeval";
import { jsonMatch, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "按用户指定的订单执行取消",
  async test(t) {
    const turn = await t.send("Cancel order A-1002, please.");
    turn.succeeded();
    turn.calledTool(toolMatch("cancel_order", { input: jsonMatch({ orderId: "A-1002" }) }))
      .label("取消用户指定的订单");
  },
});
