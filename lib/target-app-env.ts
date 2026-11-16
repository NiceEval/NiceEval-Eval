/** 目标应用直接连接 LLM 出口；凭据写入每个 Attempt 的独立 Sandbox。 */
import type { SandboxCommandContext, SandboxCommandTarget } from "niceeval/sandbox";
import { cloudflareAccessHeaders, ENV_FILE, loadRepoEnv } from "./env.ts";
import { shellQuote } from "./shell.ts";

const REQUIRED_HOST_VARS = [
  "TARGET_APP_OPENAI_API_KEY",
  "TARGET_APP_OPENAI_BASE_URL",
  "TARGET_APP_MODEL",
] as const;

export const TARGET_APP_ENV_PATH = "/opt/fixture-secrets/target-app.env";

type TargetAppContext = Pick<SandboxCommandContext, "signal" | "progress">;

/** runtime 准备阶段已创建凭据目录并授予 Sandbox 用户写权限。 */
export async function provisionTargetAppEnv(
  sandbox: SandboxCommandTarget,
  ctx: TargetAppContext,
): Promise<void> {
  ctx.signal.throwIfAborted();
  loadRepoEnv();
  for (const name of REQUIRED_HOST_VARS) {
    if (!process.env[name]) throw new Error(`${ENV_FILE} 里缺 ${name}，目标应用没有可用的 LLM 出口。`);
  }
  const upstreamBaseUrl = new URL(process.env.TARGET_APP_OPENAI_BASE_URL!);
  if (upstreamBaseUrl.protocol !== "https:") {
    throw new Error("TARGET_APP_OPENAI_BASE_URL 必须使用 HTTPS；目标应用必须通过 TLS 访问 upstream。");
  }

  ctx.progress({ message: "直连目标应用的 LLM 出口" });
  await sandbox.writeText(
    TARGET_APP_ENV_PATH,
    [
      `OPENAI_API_KEY=${shellQuote(process.env.TARGET_APP_OPENAI_API_KEY!)}`,
      `OPENAI_BASE_URL=${shellQuote(process.env.TARGET_APP_OPENAI_BASE_URL!)}`,
      `TARGET_APP_MODEL=${shellQuote(process.env.TARGET_APP_MODEL!)}`,
      `OPENAI_EXTRA_HEADERS=${shellQuote(JSON.stringify(cloudflareAccessHeaders()))}`,
      "",
    ].join("\n"),
  );
  ctx.signal.throwIfAborted();
  ctx.progress({ message: "目标应用 LLM 环境变量已就绪" });
}
