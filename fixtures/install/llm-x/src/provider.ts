import { z, type ZodType } from "zod";
import type { GeneratedImage } from "./contracts";

export interface StructuredRequest<T> {
  readonly name: "create_world" | "publish_post" | "reply" | "continue_thread" | "refresh_feed";
  readonly instructions: string;
  readonly input: unknown;
  readonly schema: ZodType<T>;
}

export interface ImageRequest {
  readonly prompt: string;
  readonly alt: string;
  readonly aspect: "square" | "wide";
}

export interface ContentProvider {
  generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T>;
  generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage>;
}

export interface LiveProviderConfig {
  apiKey: string;
  apiBase: string;
  textModel: string;
  imageModel: string;
  imageQuality?: string | undefined;
  extraHeaders?: Record<string, string> | undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return `provider HTTP ${status}`;
}

async function readJsonResponse(response: Response, signal?: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    throw new Error("provider returned invalid JSON", { cause: error });
  }
}

function readOutputText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) throw new Error("provider response is not an object");
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new Error("provider response has no output text");
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) return text;
    }
  }
  throw new Error("provider response has no output text");
}

export class OpenAICompatibleProvider implements ContentProvider {
  constructor(private readonly config: LiveProviderConfig) {
    if (!config.apiKey) throw new Error("OPENAI_API_KEY is required");
    if (!config.apiBase || !config.textModel || !config.imageModel) {
      throw new Error("OPENAI_BASE_URL, OPENAI_MODEL and OPENAI_IMAGE_MODEL are required");
    }
  }

  async generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const response = await fetch(endpoint(this.config.apiBase, "responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
        ...this.config.extraHeaders,
      },
      body: JSON.stringify({
        model: this.config.textModel,
        store: false,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        text: {
          format: {
            type: "json_schema",
            name: request.name,
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
      signal: signal ?? null,
    });
    const payload = await readJsonResponse(response, signal);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    let parsed: unknown;
    try {
      parsed = JSON.parse(readOutputText(payload));
    } catch (error) {
      throw new Error("provider returned invalid structured JSON", { cause: error });
    }
    return request.schema.parse(parsed);
  }

  async generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    throwIfAborted(signal);
    const response = await fetch(endpoint(this.config.apiBase, "images/generations"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
        ...this.config.extraHeaders,
      },
      body: JSON.stringify({
        model: this.config.imageModel,
        ...(this.config.imageQuality === undefined ? {} : { quality: this.config.imageQuality }),
        prompt: request.prompt,
        size: request.aspect === "wide" ? "1536x1024" : "1024x1024",
        n: 1,
      }),
      signal: signal ?? null,
    });
    const payload = await readJsonResponse(response, signal);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    const first = typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data[0]
      : undefined;
    if (typeof first !== "object" || first === null) throw new Error("image provider returned no image");
    const b64 = (first as { b64_json?: unknown }).b64_json;
    const url = (first as { url?: unknown }).url;
    if (typeof b64 === "string" && b64.length > 0) {
      return { url: `data:image/png;base64,${b64}`, alt: request.alt };
    }
    if (typeof url === "string" && url.length > 0) return { url, alt: request.alt };
    throw new Error("image provider returned neither b64_json nor url");
  }
}

function parseExtraHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.values(value).some((header) => typeof header !== "string")) {
    throw new Error("OPENAI_EXTRA_HEADERS must be a JSON object with string values");
  }
  return value as Record<string, string>;
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ContentProvider {
  return new OpenAICompatibleProvider({
    apiKey: env.OPENAI_API_KEY ?? "",
    apiBase: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    textModel: env.OPENAI_MODEL ?? "",
    imageModel: env.OPENAI_IMAGE_MODEL ?? "",
    imageQuality: env.OPENAI_IMAGE_QUALITY,
    extraHeaders: parseExtraHeaders(env.OPENAI_EXTRA_HEADERS),
  });
}
