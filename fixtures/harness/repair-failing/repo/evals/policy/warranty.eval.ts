import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "warranty policy returns the documented coverage period",
  tags: ["harness-policy", "policy"],
  async test(t) {
    const turn = await t.send("Do products come with a warranty?");
    turn.succeeded();
    t.check(t.reply, includes("90 days"));
  },
});
