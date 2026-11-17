import { defineEval } from "niceeval";
import { jsonMatch, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "确认支付后订单应为已支付",
  async test(t) {
    const first = await t.send("Checkout cart C-42.");
    first.succeeded();
    const second = await t.send("Pay with saved card card-9.");
    second.succeeded();
    const third = await t.send("Confirm order status.");
    third.succeeded();
    third.calledTool(toolMatch("get_order", { output: jsonMatch({ status: "paid" }) }))
      .label("订单已支付");
  },
});
