import { completeEvidenceCoverage, createSessionKey, defineAgent } from "niceeval/adapter";
import { setTimeout as sleep } from "node:timers/promises";

type Call = { name: string; input: Record<string, string | number>; output: string };
const state = createSessionKey<string>("assistant/state");

export default defineAgent({
  name: "trace-slow-turn-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    let inputTokens = 1_000;
    let delayMs = 1_000;
    if (input.text.startsWith("Book a hotel")) {
      ctx.session.set(state, "dates");
      reply = "请提供入住和退房日期。";
      delayMs = 2_500;
    } else if (input.text.startsWith("Check in") && ctx.session.get(state) === "dates") {
      ctx.session.set(state, "confirm");
      calls = [
        { name: "search_hotels", input: { city: "Shanghai", checkIn: "2026-12-01", checkOut: "2026-12-03" }, output: '{"error":"rate_limited","retryAfterSeconds":30}' },
        { name: "search_hotels", input: { city: "Shanghai", checkIn: "2026-12-01", checkOut: "2026-12-03" }, output: '{"error":"rate_limited","retryAfterSeconds":30}' },
        { name: "search_hotels", input: { city: "Shanghai", checkIn: "2026-12-01", checkOut: "2026-12-03" }, output: '{"hotels":[{"id":"H-21","name":"Harbor Hotel"}]}' },
      ];
      reply = "找到 Harbor Hotel，是否确认预订？";
      delayMs = 75_000;
    } else if (input.text.startsWith("Confirm booking") && ctx.session.get(state) === "confirm") {
      calls = [{ name: "book_hotel", input: { hotelId: "H-21" }, output: '{"bookingId":"B-901","status":"confirmed"}' }];
      reply = "预订已确认 B-901。";
      delayMs = 2_500;
    } else if (input.text.startsWith("Breakfast")) {
      reply = "Breakfast is served from 7 to 10.";
    } else if (input.text.startsWith("Parking")) {
      reply = "Parking is free for guests.";
    } else if (input.text.startsWith("Checkout time")) {
      reply = "Checkout is at 11 am.";
    }
    await sleep(delayMs, undefined, { signal: ctx.signal });
    return {
      status: reply ? "completed" : "failed",
      usage: { inputTokens, outputTokens: 100 },
      events: [
        ...calls.flatMap((call, index) => [
          { type: "operation.started" as const, operationId: `op-${index}`, operation: { kind: "tool" as const, name: call.name, input: call.input } },
          { type: "operation.finished" as const, operationId: `op-${index}`, kind: "tool" as const, status: "completed" as const, output: call.output },
        ]),
        { type: "message" as const, role: "assistant" as const, text: reply },
      ],
    };
  },
});
