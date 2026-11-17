import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "general/contact",
  async test(t) {
    const turn = await t.send("Contact support?");
    turn.succeeded();
    t.check(turn.reply, includes("support@example.com"));
  },
});
