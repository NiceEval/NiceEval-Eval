import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "privacy policy states that personal data is not sold",
  tags: ["harness-policy", "policy"],
  async test(t) {
    const turn = await t.send("How is my personal data handled?");
    turn.succeeded();
    t.check(t.reply, includes("do not sell"));
  },
});
