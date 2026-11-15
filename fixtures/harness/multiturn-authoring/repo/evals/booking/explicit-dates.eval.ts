import { defineEval } from "niceeval";
import { jsonMatch, toolMatch } from "niceeval/expect";
export default defineEval({
  description: "已给齐日期时预订房间",
  async test(t) {
    const turn = await t.send("帮我订房，入住 2026-12-04，退房 2026-12-06。");
    turn.succeeded();
    turn.calledTool(toolMatch("book_room", { input: jsonMatch({ checkIn: "2026-12-04", checkOut: "2026-12-06" }) }).exactly(1));
  },
});
