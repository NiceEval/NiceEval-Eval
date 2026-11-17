import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "formats",
  async test(t) {
    const turn = await t.send("Supported formats?");
    turn.succeeded();
    t.check(turn.reply, includes("支持 Markdown 和 PDF。"));
  },
});
