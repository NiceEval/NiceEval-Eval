import { defineEval } from "niceeval";
import { includes, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "refund-request",
  async test(t) {
    const turn = await t.send("Refund payment P-42.");
    turn.succeeded();
    t.check(turn.reply, includes("退款已受理。"));
    turn.toolOrder([toolMatch("verify_identity"), toolMatch("refund_payment")])
      .label("先核验身份再退款");
  },
});
