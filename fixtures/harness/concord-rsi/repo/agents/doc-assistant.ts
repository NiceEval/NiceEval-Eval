import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { defineAgent, completeEvidenceCoverage, type StreamEvent } from "niceeval/adapter";
import { definitions, executeTool } from "../assistant/tools.ts";

// Absorb short gateway failures without spending the Attempt on an extended outage.
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 30_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function retryDelay(retryAfter: string | null, attempt: number) {
  if (retryAfter !== null) {
    const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now();
    if (!Number.isNaN(delay)) return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, delay));
  }
  return INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

type ResponsesBody = { output?: any[]; usage?: { input_tokens: number; output_tokens: number } };

async function callResponses(url: URL, init: RequestInit, signal: AbortSignal): Promise<ResponsesBody> {
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    let response: Response | undefined;
    try {
      response = await fetch(url, { ...init, signal });
      if (response.ok) return await response.json() as ResponsesBody;
    } catch (error) {
      signal.throwIfAborted();
      // Node fetch reports transport failures as TypeError with an underlying cause.
      if (!(error instanceof TypeError) || !error.cause || attempt === MAX_REQUEST_ATTEMPTS) throw error;
    }
    if (response && !response.ok && (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_REQUEST_ATTEMPTS)) {
      throw new Error(`目标 Responses HTTP ${response.status}`);
    }
    const delay = retryDelay(response?.headers.get("retry-after") ?? null, attempt);
    await response?.body?.cancel().catch(() => {});
    await sleep(delay, undefined, { signal });
  }
}

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
    const url = new URL(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/responses`);
    const history: unknown[] = [{ role: "user", content: request }];
    const events: StreamEvent[] = [];
    let inputTokens = 0, outputTokens = 0, requests = 0;
    for (let step = 0; step < 16; step++) {
      ctx.signal.throwIfAborted();
      ctx.progress({ message: `文档助手：模型调用 ${step + 1}` });
      const body = await callResponses(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}`, ...headers },
        body: JSON.stringify({ model: env.TARGET_APP_MODEL, instructions: skill, input: history, tools: definitions,
          reasoning: { effort: "low" }, store: false, stream: false }),
      }, ctx.signal);
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
