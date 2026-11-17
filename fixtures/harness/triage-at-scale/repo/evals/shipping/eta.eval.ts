import { defineEval } from "niceeval";
import { equals, includes, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "shipping/eta",
  async test(t) {
    const turn = await t.send("包裹 A-42 预计什么时候送到？");
    turn.succeeded();
    t.check(turn.reply, includes("周二"));
    turn.calledTool(toolMatch("track_package", { status: "completed", output: equals('{"eta":"周二"}') })).label("ETA 必须来自成功的物流查询，不能在工具超时后编造");
  },
});
