/**
 * 目标应用的 LLM 出口。
 *
 * install sandbox 把 raw DinD 交给被测 coding agent；任何放进评估容器的长期凭证都能被它
 * 通过内层 Docker daemon 读走，Unix 权限不是安全边界。因此真实 key/base URL 只进入宿主
 * Docker daemon 管理的独立 sidecar，和 agent 控制的内层 daemon 完全隔离。沙箱里只有：
 *
 * - 一个 Attempt 生命周期内有效的随机 Bearer token；
 * - 只允许固定模型、固定接口和有限请求数的代理地址；
 * - TARGET_APP_MODEL 这个非敏感配置。
 *
 * sidecar 加入当前 Sandbox 的外层 Docker network，避免依赖经常被宿主防火墙阻断的 host
 * gateway 回连。setup 任一步失败都会删除 sidecar，teardown 再做幂等回收；AutoRemove 与
 * 40 分钟硬生命周期用于进程异常退出时兜底。
 */

import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import type { Container, ContainerInspectInfo } from "dockerode";
import type { Sandbox, SandboxHook } from "niceeval/sandbox";
import { ENV_FILE, loadRepoEnv } from "./env.ts";

const REQUIRED_HOST_VARS = [
  "TARGET_APP_OPENAI_API_KEY",
  "TARGET_APP_OPENAI_BASE_URL",
  "TARGET_APP_MODEL",
] as const;

const PROXY_PORT = 43129;
const MAX_REQUESTS = 96;
const MAX_CONCURRENCY = 8;
const MAX_REQUEST_BYTES = 1024 * 1024;

/** Agent 只会看到这份短期配置，不会看到宿主侧真实 key/base URL。 */
export const TARGET_APP_ENV_PATH = "/opt/fixture-secrets/target-app.env";

interface ProxyHandle {
  token: string;
  endpoint: string;
  detachAbort?: () => void;
  close(): Promise<void>;
}

const docker = new Docker();
const proxies = new WeakMap<Sandbox, ProxyHandle>();

/** 创建外层 sidecar，并把可安全泄漏的连接信息写进 sandbox。 */
export function provisionTargetAppEnv(): SandboxHook {
  return async (sandbox, ctx) => {
    loadRepoEnv();
    for (const name of REQUIRED_HOST_VARS) {
      if (!process.env[name]) throw new Error(`${ENV_FILE} 里缺 ${name}，目标应用没有可用的 LLM 出口。`);
    }

    ctx.progress({ message: "启动目标应用的 Attempt 级 LLM 代理" });
    const handle = await startProxySidecar(sandbox, {
      apiKey: process.env.TARGET_APP_OPENAI_API_KEY!,
      baseUrl: process.env.TARGET_APP_OPENAI_BASE_URL!,
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
        ["--max-time", "1", "--fail", "--silent", `${handle.endpoint}/__niceeval_health`],
      );
      for (let attempt = 1; health.exitCode !== 0 && attempt < 20; attempt++) {
        await new Promise((done) => setTimeout(done, 100));
        health = await sandbox.runCommand(
          "curl",
          ["--max-time", "1", "--fail", "--silent", `${handle.endpoint}/__niceeval_health`],
        );
      }
      if (health.exitCode !== 0 || health.stdout.trim() !== "ok") {
        throw new Error("目标应用短期代理 sidecar 无法从 Docker sandbox 访问；这是环境 setup 问题。");
      }
      ctx.progress({ message: "目标应用短期 LLM 代理已就绪" });
    } catch (error) {
      await closeProxy(sandbox);
      throw error;
    }
  };
}

/** Sandbox 无论正常、失败或中断都撤销 token 并删除外层 sidecar。 */
export function teardownTargetAppProxy(): SandboxHook {
  return async (sandbox) => {
    await closeProxy(sandbox);
  };
}

async function closeProxy(sandbox: Sandbox): Promise<void> {
  const handle = proxies.get(sandbox);
  if (!handle) return;
  handle.detachAbort?.();
  await handle.close();
  if (proxies.get(sandbox) === handle) proxies.delete(sandbox);
}

async function startProxySidecar(
  sandbox: Sandbox,
  config: { apiKey: string; baseUrl: string; model: string },
): Promise<ProxyHandle> {
  const parent = await docker.getContainer(sandbox.sandboxId).inspect();
  const networkName = selectSandboxNetwork(parent);
  const token = randomBytes(32).toString("base64url");
  let container: Container | undefined;
  try {
    container = await docker.createContainer({
      Image: parent.Image,
      Entrypoint: ["node"],
      Cmd: ["-e", PROXY_PROGRAM],
      Env: [
        `PROXY_TOKEN=${token}`,
        `UPSTREAM_API_KEY=${config.apiKey}`,
        `UPSTREAM_BASE_URL=${config.baseUrl}`,
        `TARGET_MODEL=${config.model}`,
        `PROXY_PORT=${PROXY_PORT}`,
        `MAX_REQUESTS=${MAX_REQUESTS}`,
        `MAX_CONCURRENCY=${MAX_CONCURRENCY}`,
        `MAX_REQUEST_BYTES=${MAX_REQUEST_BYTES}`,
      ],
      User: "node",
      Labels: {
        "niceeval.resource": "target-app-proxy",
        "niceeval.parent-sandbox": sandbox.sandboxId,
      },
      HostConfig: {
        AutoRemove: true,
        NetworkMode: networkName,
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Memory: 128 * 1024 * 1024,
        NanoCpus: 250_000_000,
        PidsLimit: 64,
      },
    });
    await container.start();
    const info = await container.inspect();
    const address = info.NetworkSettings.Networks[networkName]?.IPAddress;
    if (!address) throw new Error("目标应用代理 sidecar 没有取得 Sandbox network 地址");

    let closing: Promise<void> | undefined;
    return {
      token,
      endpoint: `http://${address}:${PROXY_PORT}`,
      close: () => closing ??= removeContainer(container!),
    };
  } catch (error) {
    if (container) await removeContainer(container);
    throw new Error("创建目标应用短期代理 sidecar 失败", { cause: error });
  }
}

function selectSandboxNetwork(parent: ContainerInspectInfo): string {
  const names = Object.keys(parent.NetworkSettings.Networks);
  if (names.length !== 1) {
    throw new Error(`Sandbox 必须恰好连接一个外层 Docker network，实测 ${names.length} 个`);
  }
  return names[0]!;
}

async function removeContainer(container: Container): Promise<void> {
  try {
    await container.remove({ force: true });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404) return;
    if (status !== 409) throw error;

    // AutoRemove 容器在极短的退出/删除窗口可能拒绝 remove；stop 后由 daemon 回收。
    await container.stop({ t: 0 }).catch((stopError: unknown) => {
      const stopStatus = (stopError as { statusCode?: number }).statusCode;
      if (stopStatus !== 304 && stopStatus !== 404) throw stopError;
    });
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

/**
 * 在 sidecar 内运行；只从 sidecar env 读取真实凭证。程序不打印请求、响应、URL 或 key。
 * Token、模型、接口、并发、请求体与调用次数全部在转发前收窄。
 */
const PROXY_PROGRAM = String.raw`
const http = require("node:http");

const port = Number(process.env.PROXY_PORT);
const token = process.env.PROXY_TOKEN;
const upstreamKey = process.env.UPSTREAM_API_KEY;
const upstreamBase = new URL(process.env.UPSTREAM_BASE_URL);
const targetModel = process.env.TARGET_MODEL;
const maxRequests = Number(process.env.MAX_REQUESTS);
const maxConcurrency = Number(process.env.MAX_CONCURRENCY);
const maxRequestBytes = Number(process.env.MAX_REQUEST_BYTES);
let requests = 0;
let active = 0;

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxRequestBytes) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function upstreamUrl(incoming) {
  const basePath = upstreamBase.pathname.replace(/\/$/, "");
  const incomingPath = incoming.pathname;
  const path = incomingPath === basePath || incomingPath.startsWith(basePath + "/")
    ? incomingPath
    : basePath.endsWith("/v1") && incomingPath.startsWith("/v1/")
      ? basePath + incomingPath.slice(3)
      : basePath + incomingPath;
  return new URL(path + incoming.search, upstreamBase.origin);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/__niceeval_health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    if (request.headers.authorization !== "Bearer " + token) {
      sendJson(response, 401, { error: { message: "target proxy token is invalid" } });
      return;
    }
    const url = new URL(request.url || "/", "http://sandbox.invalid");
    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, {
        object: "list",
        data: [{ id: targetModel, object: "model", owned_by: "niceeval-target-proxy" }],
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      sendJson(response, 404, { error: { message: "target proxy only permits /v1/chat/completions" } });
      return;
    }
    if (requests >= maxRequests || active >= maxConcurrency) {
      sendJson(response, 429, { error: { message: "target proxy attempt budget exhausted" } });
      return;
    }

    const payload = JSON.parse(await readBody(request));
    payload.model = targetModel;
    requests += 1;
    active += 1;
    try {
      const upstream = await fetch(upstreamUrl(url), {
        method: "POST",
        headers: {
          authorization: "Bearer " + upstreamKey,
          "content-type": "application/json",
          accept: request.headers.accept || "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      const headers = {};
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
      active -= 1;
    }
  } catch {
    if (!response.headersSent) sendJson(response, 502, { error: { message: "target proxy upstream request failed" } });
    else response.end();
  }
});

server.listen(port, "0.0.0.0");
setTimeout(() => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
}, 40 * 60 * 1000).unref();
`;
