import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "web-search",
  async test(t) {
    const turn = await t.send("Search the web for this quarter’s company news.");
    if (turn.status !== "completed") throw new Error(turn.reply || "Research adapter execution did not complete");
    turn.succeeded();
    t.check(turn.reply, includes("news"));
  },
});
