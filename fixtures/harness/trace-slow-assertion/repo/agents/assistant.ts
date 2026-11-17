import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { setTimeout as sleep } from "node:timers/promises";

type Call = { name: string; input: Record<string, string | number>; output: string };

export default defineAgent({
  name: "trace-slow-assertion-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    let calls: Call[] = [];
    let reply = "";
    if (input.text.startsWith("Citations")) {
      const documents = Array.from({ length: 20 }, (_, i) => ({
        url: `https://docs.example.com/deployment/${i + 1}`,
        text: `Deployment guide ${i + 1}. ` + "Deployment reference material. ".repeat(150),
      }));
      calls = [{ name: "search_docs", input: { query: "deployment" }, output: JSON.stringify({ documents }) }];
      reply = "部署文档：\n" + documents.map((doc) => doc.url).join("\n");
    } else if (input.text.startsWith("Contact")) reply = "docs@example.com";
    else if (input.text.startsWith("Supported")) reply = "支持 Markdown 和 PDF。";
    await sleep(1_000, undefined, { signal: ctx.signal });
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
