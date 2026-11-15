import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "export-pdf",
  async test(t) {
    const turn = await t.send("Export this research report as a PDF.");
    if (turn.status !== "completed") throw new Error(turn.reply || "Research adapter execution did not complete");
    turn.succeeded();
    t.check(turn.reply, includes("PDF"));
  },
});
