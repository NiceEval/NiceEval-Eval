import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import type { StreamEvent } from "niceeval";

export default defineAgent({
  name: "flight-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    ctx.session.capture("flight-session");
    const text = input.responses?.map(response => response.text ?? response.optionId ?? "").join(" ") ?? input.text;
    const events: StreamEvent[] = [];
    const tool = (name: string, args: Record<string, string>) => {
      events.push({ type: "operation.started", operationId: name, operation: { kind: "tool", name, input: args } });
      events.push({ type: "operation.finished", operationId: name, kind: "tool", status: "completed", output: { ok: true } });
    };
    if (/算了|取消|不订/.test(text)) return {
      status: "completed", events: [{ type: "message", role: "assistant", text: "好的，已停止预订，不会扣款。" }],
    };
    const day = text.match(/周[一二三四五六日天]/)?.[0];
    if (!day) return {
      status: "waiting",
      events: [
        { type: "message", role: "assistant", text: "请问您哪天出发？" },
        { type: "input.requested", request: { id: "departure-date", action: "clarify_departure_date", prompt: "请问您哪天出发？" } },
      ],
    };
    tool("search_flights", { destination: "大阪", departureDay: day });
    events.push({ type: "message", role: "assistant", text: `正在查询${day}去大阪的航班，尚未预订或扣款。` });
    return { status: "completed", events };
  },
});
