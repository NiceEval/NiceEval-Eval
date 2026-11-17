import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { defineAgent, completeEvidenceCoverage, type StreamEvent } from "niceeval/adapter";
import { definitions, executeTool } from "../assistant/tools.ts";


function connection(): Record<string, string> {
  // sh parses the provisioner's shell-quoted values without printing them to the terminal.
  return JSON.parse(execFileSync("sh", ["-c", ". /opt/fixture-secrets/target-app.env; export OPENAI_API_KEY OPENAI_BASE_URL TARGET_APP_MODEL OPENAI_EXTRA_HEADERS; node -e 'process.stdout.write(JSON.stringify(Object.fromEntries([\"OPENAI_API_KEY\",\"OPENAI_BASE_URL\",\"TARGET_APP_MODEL\",\"OPENAI_EXTRA_HEADERS\"].map(k=>[k,process.env[k]]))))'"], { encoding: "utf8" }));
}

export default defineAgent({
  name: "concord-doc-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const { root, request } = JSON.parse(input.text ?? "{}") as { root: string; request: string };
    if (!root || !request) throw new Error("需要项目路径与任务正文");
    const skill = await readFile(new URL("../assistant/SKILL.md", import.meta.url), "utf8");
    const env = connection();
    if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL || !env.TARGET_APP_MODEL) throw new Error("目标应用凭据不完整");
    const headers = JSON.parse(env.OPENAI_EXTRA_HEADERS || "{}");
    const history: unknown[] = [{ role: "user", content: request }];
    const events: StreamEvent[] = [];
    let inputTokens = 0, outputTokens = 0, requests = 0;
    for (let step = 0; step < 16; step++) {
      ctx.signal.throwIfAborted();
      ctx.progress({ message: `文档助手：模型调用 ${step + 1}` });
      const response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/responses`, {
        method: "POST", signal: ctx.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}`, ...headers },
        body: JSON.stringify({ model: env.TARGET_APP_MODEL, instructions: skill, input: history, tools: definitions,
          reasoning: { effort: "low" }, store: false, stream: false }),
      });
      if (!response.ok) throw new Error(`目标 Responses HTTP ${response.status}`);
      const body = await response.json() as { output?: any[]; usage?: { input_tokens: number; output_tokens: number }; status?: string };
      if (!Array.isArray(body.output)) throw new Error("Responses 缺少 output");
      requests++;
      inputTokens += body.usage?.input_tokens ?? 0;
      outputTokens += body.usage?.output_tokens ?? 0;
      history.push(...body.output);
      let calls = 0;
      for (const item of body.output) {
        if (item.type === "message") {
          for (const part of item.content ?? []) if (part.type === "output_text") events.push({ type: "message", role: "assistant", text: part.text });
        }
        if (item.type !== "function_call") continue;
        calls++;
        const args = JSON.parse(item.arguments);
        events.push({ type: "operation.started", operationId: item.call_id, operation: { kind: "tool", name: item.name, input: args } });
        let result: unknown;
        try { result = await executeTool(root, item.name, args, ctx.signal); }
        catch (e) { ctx.signal.throwIfAborted(); result = { error: (e as Error).message }; }
        events.push({ type: "operation.finished", operationId: item.call_id, kind: "tool", status: "completed", output: result as any });
        history.push({ type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result) });
      }
      if (calls === 0) return { status: "completed", events, usage: { inputTokens, outputTokens, requests } };
    }
    return { status: "failed", events: [...events, { type: "error", message: "文档助手超过 16 步" }], usage: { inputTokens, outputTokens, requests } };
  },
});
