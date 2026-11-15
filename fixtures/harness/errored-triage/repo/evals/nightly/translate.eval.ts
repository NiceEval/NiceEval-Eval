import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  description: "translate",
  async test(t) {
    const turn = await t.send("Translate 你好，世界！ into English.");
    turn.succeeded();
    t.check(turn.reply, includes("Hello, world!"));
  },
});
