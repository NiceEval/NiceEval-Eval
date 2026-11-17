import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import type { StreamEvent } from "niceeval";

export default defineAgent({
  name: "research-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    if (!ctx.attempt) throw new Error("Expected a Runner Attempt reference");
    if (!input.text.includes("检索")) return { status: "completed", events: [{ type: "message", role: "assistant", text: "你好，我是研究助手。" }] };
    const mode = process.env.HARNESS_SOURCES_PROBE;
    if (!["order-a", "order-b", "missing", "fabricated", "duplicate"].includes(mode ?? "")) throw new Error("Unknown sources probe");
    const reversed = mode === "order-b";
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "web", operation: { kind: "tool", name: "search_web", input: { query: "电池回收" } } },
      { type: "operation.started", operationId: "papers", operation: { kind: "tool", name: "search_papers", input: { query: "电池回收" } } },
    ];
    const web: StreamEvent = { type: "operation.finished", operationId: "web", kind: "tool", status: "completed", output: { source: "https://energy.example/report", title: "电池回收报告" } };
    const paper: StreamEvent = { type: "operation.finished", operationId: "papers", kind: "tool", status: "completed", output: { source: "https://papers.example/study", title: "回收技术研究" } };
    events.push(...(reversed ? [paper, web] : [web, paper]));
    const sources = reversed ? ["https://papers.example/study", "https://energy.example/report"] : ["https://energy.example/report", "https://papers.example/study"];
    if (mode === "missing") sources.pop();
    if (mode === "fabricated") sources.push("https://invented.example/nonexistent");
    if (mode === "duplicate") sources.push(...sources);
    events.push({ type: "message", role: "assistant", text: "电池回收有助于资源再利用。\n来源：\n" + sources.map(source => `- ${source}`).join("\n") });
    return { status: "completed", events };
  },
});
