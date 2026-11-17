import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "support/hours",
  async test(t) {
    const turn = await t.send("你们什么时候营业？");
    turn.succeeded();
    t.check(turn.reply, includes("9:00"));
  },
});
