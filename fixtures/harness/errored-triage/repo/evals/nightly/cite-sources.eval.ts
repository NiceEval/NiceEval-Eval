import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "cite-sources",
  async test(t) {
    const turn = await t.send("Cite the quarterly report. Allowed sources: https://reports.example/quarterly");
    turn.succeeded();
    t.check(turn.reply, includes("https://reports.example/quarterly"));
  },
});
