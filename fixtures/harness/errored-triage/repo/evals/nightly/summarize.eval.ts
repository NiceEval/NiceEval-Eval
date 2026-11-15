import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "summarize",
  async test(t) {
    const turn = await t.send("Summarize this financial report: quarterly revenue was 4.2M.");
    turn.succeeded();
    t.check(turn.reply, includes("4.2M"));
  },
});
