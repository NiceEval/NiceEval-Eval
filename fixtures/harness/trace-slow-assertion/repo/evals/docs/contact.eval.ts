import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "contact",
  async test(t) {
    const turn = await t.send("Contact docs team.");
    turn.succeeded();
    t.check(turn.reply, includes("docs@example.com"));
  },
});
