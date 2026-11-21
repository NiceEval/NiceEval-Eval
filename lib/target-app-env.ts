/** 目标应用直接连接 LLM 出口；凭据写入每个 Attempt 的独立 Sandbox。 */
import type { SandboxCommandContext, SandboxCommandTarget } from "niceeval/sandbox";
import { cloudflareAccessHeaders, ENV_FILE, loadRepoEnv } from "./env.ts";
import { shellQuote } from "./shell.ts";

const DEFAULT_HOST_VARS = {
  apiKey: "TARGET_APP_OPENAI_API_KEY",
  baseUrl: "TARGET_APP_OPENAI_BASE_URL",
  model: "TARGET_APP_MODEL",
};

export const TARGET_APP_ENV_PATH = "/opt/fixture-secrets/target-app.env";

type TargetAppContext = Pick<SandboxCommandContext, "signal" | "progress">;

/** runtime 准备阶段已创建凭据目录并授予 Sandbox 用户写权限。 */
export async function provisionTargetAppEnv(
  sandbox: SandboxCommandTarget,
  ctx: TargetAppContext,
  hostVars: typeof DEFAULT_HOST_VARS = DEFAULT_HOST_VARS,
): Promise<void> {
  ctx.signal.throwIfAborted();
  loadRepoEnv();
  const apiKey = process.env[hostVars.apiKey];
  const baseUrl = process.env[hostVars.baseUrl];
  const model = process.env[hostVars.model];
  if (!apiKey || !baseUrl || !model) {
    const missing = !apiKey ? hostVars.apiKey : !baseUrl ? hostVars.baseUrl : hostVars.model;
    throw new Error(`${ENV_FILE} 里缺 ${missing}，目标应用没有可用的 LLM 出口。`);
  }
  const upstreamBaseUrl = new URL(baseUrl);
  if (upstreamBaseUrl.protocol !== "https:") {
    throw new Error(`${hostVars.baseUrl} 必须使用 HTTPS；目标应用必须通过 TLS 访问 upstream。`);
  }

  ctx.progress({ message: "直连目标应用的 LLM 出口" });
  await sandbox.writeText(
    TARGET_APP_ENV_PATH,
    [
      `OPENAI_API_KEY=${shellQuote(apiKey)}`,
      `OPENAI_BASE_URL=${shellQuote(baseUrl)}`,
      `TARGET_APP_MODEL=${shellQuote(model)}`,
      `OPENAI_EXTRA_HEADERS=${shellQuote(JSON.stringify(cloudflareAccessHeaders()))}`,
      "",
    ].join("\n"),
  );
  ctx.signal.throwIfAborted();
  ctx.progress({ message: "目标应用 LLM 环境变量已就绪" });
}
