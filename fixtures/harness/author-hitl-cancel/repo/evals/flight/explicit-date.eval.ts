import { defineEval } from "niceeval";
import { jsonMatch, toolMatch } from "niceeval/expect";
export default defineEval({
  description: "明确日期时查询去大阪的航班",
  async test(t) {
    const turn = await t.send("帮我查周二去大阪的航班。");
    turn.succeeded();
    turn.calledTool(toolMatch("search_flights", { input: jsonMatch({ destination: "大阪", departureDay: "周二" }) }).exactly(1));
    t.notCalledTool("charge_card");
  },
});
