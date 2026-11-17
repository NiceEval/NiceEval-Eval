import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { setTimeout as sleep } from "node:timers/promises";

type Call = { name: string; input: Record<string, string | number>; output: string };

export default defineAgent({
  name: "trace-flaky-cause-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    if (input.text.startsWith("Umbrella")) {
      if (!ctx.attempt) throw new Error("Expected a Runner Attempt reference");
      const cached = ctx.attempt.index % 2 === 1;
      calls = [{ name: "get_forecast", input: { city: "Shanghai" }, output: JSON.stringify(cached
        ? { cached: true, ageSeconds: 7200, rainChance: 0.1 }
        : { cached: false, rainChance: 0.8 }) }];
      reply = cached ? "不用带伞。" : "记得带伞。";
      if (cached) await sleep(1_500, undefined, { signal: ctx.signal });
    } else if (input.text.startsWith("Temperature")) reply = "今天 22 度。";
    else if (input.text.startsWith("Wind")) reply = "今天微风。";
    return {
      status: reply ? "completed" : "failed",
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
