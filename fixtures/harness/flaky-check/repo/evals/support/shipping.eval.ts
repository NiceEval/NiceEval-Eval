import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "shipping: 是否寄往加拿大",
  async test(t) {
    const turn = await t.send("Do you ship to Canada?");
    turn.succeeded();
    t.check(turn.reply, includes("ship to Canada"));
  },
});
