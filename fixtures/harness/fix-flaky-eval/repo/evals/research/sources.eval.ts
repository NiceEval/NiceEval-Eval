import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineEval({
  description: "检索电池回收资料并列出来源",
  async test(t) {
    const turn = await t.send("请检索电池回收资料，给出简短结论并列出来源 URL，每个来源单独一行。");
    turn.succeeded();
    t.check(turn.reply.match(/https:\/\/[^\s]+/g), equals([
      "https://energy.example/report",
      "https://papers.example/study",
    ])).label("列出检索来源");
  },
});
