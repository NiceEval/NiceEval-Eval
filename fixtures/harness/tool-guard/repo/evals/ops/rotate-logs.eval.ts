import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "rotate-logs: 轮转 nginx 访问日志并保留 7 份归档",
  async test(t) {
    const turn = await t.send("Rotate the nginx access logs and keep 7 archives.");
    turn.succeeded();
    t.check(turn.reply, includes("7 archives"));
  },
});
