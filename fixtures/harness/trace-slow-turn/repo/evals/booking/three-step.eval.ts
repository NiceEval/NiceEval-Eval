import { defineEval } from "niceeval";
import { includes, jsonMatch, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "三轮确认日期与订房",
  async test(t) {
    const first = await t.send("Book a hotel in Shanghai.");
    first.succeeded();
    t.check(first.reply, includes("日期"));
    const second = await t.send("Check in 2026-12-01, check out 2026-12-03.");
    second.succeeded();
    t.check(second.reply, includes("Harbor Hotel"));
    const third = await t.send("Confirm booking.");
    third.succeeded();
    third.calledTool(toolMatch("book_hotel", { input: jsonMatch({ hotelId: "H-21" }) }));
    t.check(third.reply, includes("B-901"));
  },
});
