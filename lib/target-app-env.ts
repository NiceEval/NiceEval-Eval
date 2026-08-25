/**
 * 目标应用的 LLM 出口。
 *
 * install sandbox 把一次性 Incus VM 里的 guest Docker daemon 交给被测 coding agent；
 * 写进 guest、workspace 或日志的长期凭证都能被它读走。因此真实 upstream key 与
 * base URL 只留在 NiceEval 宿主进程的 closure。沙箱里只有：
 *
 * - 一个 Attempt 生命周期内有效的随机 Bearer token；
 * - 只允许固定模型、固定接口和有限请求数的代理地址；
 * - TARGET_APP_MODEL 这个非敏感配置。
 *
 * 代理在宿主进程内按 Attempt 启动 Node HTTP server，host 强制绑定 Incus bridge
 * gateway `10.89.53.1`，不可覆写。端口默认 18080，可用 TARGET_APP_PROXY_PORT
 * 覆写以对齐宿主配置。不绑定其它地址、0.0.0.0、公网或 loopback。
 * setup 任一步失败都会撤销 token，teardown 再做幂等回收；release / abort /
 * 40 分钟硬结束会 abort 所有进行中的 upstream fetch。WeakMap 仍按 sandbox facade 工作。
 */

import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  SandboxCommandContext,
  SandboxCommandTarget,
} from "niceeval/sandbox";
import { ENV_FILE, loadRepoEnv } from "./env.ts";

const REQUIRED_HOST_VARS = [
  "TARGET_APP_OPENAI_API_KEY",
  "TARGET_APP_OPENAI_BASE_URL",
  "TARGET_APP_MODEL",
] as const;

const PROXY_HOST = "10.89.53.1";
const DEFAULT_PROXY_PORT = 18080;
const MAX_REQUESTS = 96;
const MAX_CONCURRENCY = 8;
const MAX_REQUEST_BYTES = 1024 * 1024;
const HARD_STOP_MS = 40 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

/** Agent 只会看到这份短期配置，不会看到宿主侧真实 key/base URL。 */
export const TARGET_APP_ENV_PATH = "/opt/fixture-secrets/target-app.env";

interface ProxySession {
  token: string;
  healthNonce: string;
  model: string;
  apiKey: string;
  baseUrl: URL;
  requests: number;
  active: number;
  abort: AbortController;
  hardStop: ReturnType<typeof setTimeout>;
}

interface ProxyHandle {
  token: string;
  endpoint: string;
  healthNonce: string;
  detachAbort?: () => void;
  close(): Promise<void>;
}

interface SharedListener {
  host: string;
  port: number;
  server: Server;
  sessions: Map<string, ProxySession>;
}

const proxies = new WeakMap<SandboxCommandTarget, ProxyHandle>();
let listener: SharedListener | undefined;
let listenerReady: Promise<SharedListener> | undefined;

type TargetAppContext = Pick<
  Omit<SandboxCommandContext, "onCleanup">,
  "signal" | "progress"
>;

/** 创建宿主进程内 Attempt 级代理，并把可安全泄漏的连接信息写进 sandbox。 */
export async function provisionTargetAppEnv(
  sandbox: SandboxCommandTarget,
  ctx: TargetAppContext,
): Promise<void> {
  loadRepoEnv();
  for (const name of REQUIRED_HOST_VARS) {
    if (!process.env[name]) throw new Error(`${ENV_FILE} 里缺 ${name}，目标应用没有可用的 LLM 出口。`);
  }
  const upstreamBaseUrl = new URL(process.env.TARGET_APP_OPENAI_BASE_URL!);
  if (upstreamBaseUrl.protocol !== "https:") {
    throw new Error("TARGET_APP_OPENAI_BASE_URL 必须使用 HTTPS；真实 upstream 只留在宿主进程。");
  }

  ctx.progress({ message: "启动目标应用的 Attempt 级 LLM 代理" });
  const handle = await startProxy({
    apiKey: process.env.TARGET_APP_OPENAI_API_KEY!,
    baseUrl: upstreamBaseUrl,
    model: process.env.TARGET_APP_MODEL!,
  });
  proxies.set(sandbox, handle);

  const abort = () => { void closeProxy(sandbox); };
  handle.detachAbort = () => ctx.signal.removeEventListener("abort", abort);
  ctx.signal.addEventListener("abort", abort, { once: true });
  try {
    await sandbox.writeText(
      TARGET_APP_ENV_PATH,
      [
        `OPENAI_API_KEY=${shellQuote(handle.token)}`,
        `OPENAI_BASE_URL=${shellQuote(`${handle.endpoint}/v1`)}`,
        `TARGET_APP_MODEL=${shellQuote(process.env.TARGET_APP_MODEL!)}`,
        "",
      ].join("\n"),
    );

    let health = await sandbox.runCommand(
      "curl",
      ["--max-time", "1", "--fail", "--silent", `${handle.endpoint}/__niceeval_health/${handle.healthNonce}`],
    );
    for (let attempt = 1; health.exitCode !== 0 && attempt < 20; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      health = await sandbox.runCommand(
        "curl",
        ["--max-time", "1", "--fail", "--silent", `${handle.endpoint}/__niceeval_health/${handle.healthNonce}`],
      );
    }
    if (health.exitCode !== 0 || health.stdout.trim() !== handle.healthNonce) {
      throw new Error("目标应用短期代理无法从 Incus sandbox 访问；这是环境 setup 问题。");
    }
    ctx.progress({ message: "目标应用短期 LLM 代理已就绪" });
  } catch (error) {
    await closeProxy(sandbox);
    throw error;
  }
}

/** Sandbox 无论正常、失败或中断都撤销 token 并关闭宿主代理。 */
export async function teardownTargetAppProxy(sandbox: SandboxCommandTarget): Promise<void> {
  await closeProxy(sandbox);
}

async function closeProxy(sandbox: SandboxCommandTarget): Promise<void> {
  const handle = proxies.get(sandbox);
  if (!handle) return;
  handle.detachAbort?.();
  await handle.close();
  if (proxies.get(sandbox) === handle) proxies.delete(sandbox);
}

function proxyBind(): { host: string; port: number } {
  const portRaw = process.env.TARGET_APP_PROXY_PORT?.trim();
  const port = portRaw === undefined || portRaw === "" ? DEFAULT_PROXY_PORT : Number(portRaw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("TARGET_APP_PROXY_PORT 必须是 1–65535 的整数");
  }
  return { host: PROXY_HOST, port };
}

async function startProxy(config: { apiKey: string; baseUrl: URL; model: string }): Promise<ProxyHandle> {
  const bind = proxyBind();
  const token = randomBytes(32).toString("base64url");
  const healthNonce = randomBytes(16).toString("base64url");
  let closed = false;

  try {
    const shared = await ensureListener(bind.host, bind.port);
    const session: ProxySession = {
      token,
      healthNonce,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      requests: 0,
      active: 0,
      abort: new AbortController(),
      hardStop: setTimeout(() => {
        void releaseSession(token);
      }, HARD_STOP_MS),
    };
    session.hardStop.unref();
    shared.sessions.set(token, session);

    return {
      token,
      endpoint: `http://${bind.host}:${bind.port}`,
      healthNonce,
      close: async () => {
        if (closed) return;
        closed = true;
        await releaseSession(token);
      },
    };
  } catch (error) {
    throw new Error(
      `目标应用短期代理无法绑定 Incus bridge gateway ${bind.host}:${bind.port}`,
      { cause: error },
    );
  }
}

async function ensureListener(host: string, port: number): Promise<SharedListener> {
  if (listener && listener.host === host && listener.port === port) return listener;
  if (listener) {
    throw new Error(
      `目标应用代理已绑定 ${listener.host}:${listener.port}，不能再绑定 ${host}:${port}`,
    );
  }
  listenerReady ??= listen(host, port);
  try {
    return await listenerReady;
  } catch (error) {
    listenerReady = undefined;
    throw error;
  }
}

function listen(host: string, port: number): Promise<SharedListener> {
  return new Promise((resolve, reject) => {
    const sessions = new Map<string, ProxySession>();
    const server = createServer((request, response) => {
      void handleProxyRequest(sessions, request, response);
    });
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const shared: SharedListener = { host, port, server, sessions };
      listener = shared;
      resolve(shared);
    });
  });
}

async function releaseSession(token: string): Promise<void> {
  const current = listener;
  if (!current) return;
  const session = current.sessions.get(token);
  if (session) {
    clearTimeout(session.hardStop);
    session.abort.abort();
    current.sessions.delete(token);
  }
  if (current.sessions.size > 0) return;
  listener = undefined;
  listenerReady = undefined;
  try {
    await closeServer(current.server);
  } catch {
    // 幂等：abort / 40 分钟硬结束可能已经关掉同一 listener。
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections();
  });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("request-too-large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sessionByHealthNonce(
  sessions: Map<string, ProxySession>,
  nonce: string,
): ProxySession | undefined {
  for (const session of sessions.values()) {
    if (session.healthNonce === nonce) return session;
  }
  return undefined;
}

function upstreamUrl(base: URL, incoming: URL): URL {
  const basePath = base.pathname.replace(/\/$/u, "");
  const incomingPath = incoming.pathname;
  const path = incomingPath === basePath || incomingPath.startsWith(`${basePath}/`)
    ? incomingPath
    : basePath.endsWith("/v1") && incomingPath.startsWith("/v1/")
      ? basePath + incomingPath.slice(3)
      : basePath + incomingPath;
  return new URL(path + incoming.search, base.origin);
}

async function handleProxyRequest(
  sessions: Map<string, ProxySession>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(request.url || "/", "http://sandbox.invalid");
    const healthPrefix = "/__niceeval_health/";
    if (url.pathname.startsWith(healthPrefix)) {
      const nonce = url.pathname.slice(healthPrefix.length);
      const health = sessionByHealthNonce(sessions, nonce);
      if (health === undefined) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(health.healthNonce);
      return;
    }

    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    const session = token === undefined ? undefined : sessions.get(token);
    if (session === undefined) {
      sendJson(response, 401, { error: { message: "target proxy token is invalid" } });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, {
        object: "list",
        data: [{ id: session.model, object: "model", owned_by: "niceeval-target-proxy" }],
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      sendJson(response, 404, { error: { message: "target proxy only permits /v1/chat/completions" } });
      return;
    }
    if (session.requests >= MAX_REQUESTS || session.active >= MAX_CONCURRENCY) {
      sendJson(response, 429, { error: { message: "target proxy attempt budget exhausted" } });
      return;
    }

    const payload = JSON.parse(await readBody(request)) as { model?: string };
    payload.model = session.model;
    session.requests += 1;
    session.active += 1;
    try {
      const upstream = await fetch(upstreamUrl(session.baseUrl, url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.apiKey}`,
          "content-type": "application/json",
          accept: request.headers.accept || "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([
          session.abort.signal,
          AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        ]),
      });
      const headers: Record<string, string> = {};
      for (const [name, value] of upstream.headers) {
        if (!["connection", "content-length", "keep-alive", "transfer-encoding", "upgrade"].includes(name.toLowerCase())) {
          headers[name] = value;
        }
      }
      response.writeHead(upstream.status, headers);
      if (upstream.body) {
        for await (const chunk of upstream.body) response.write(Buffer.from(chunk));
      }
      response.end();
    } finally {
      session.active -= 1;
    }
  } catch {
    if (!response.headersSent) sendJson(response, 502, { error: { message: "target proxy upstream request failed" } });
    else response.end();
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function assertEnvContracts(): void {
  if (shellQuote("a'b # c") !== "'a'\\''b # c'") {
    throw new Error("target proxy env quoting contract 失败");
  }
}

assertEnvContracts();
