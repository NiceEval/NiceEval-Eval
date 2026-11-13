/** Instabox 普通执行路径：每 Attempt 独立实例，实际检查 Docker/Compose。
 * 基础镜像使用 Instabox universal 模板，BeforeCache 自动保存和恢复远端快照。
 */

import { readFileSync } from "node:fs";
import { codexAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  defineSandboxCommand,
  instaboxSandbox,
  shell,
  uploadDirectory,
} from "niceeval/sandbox";
import { loadRepoEnv } from "./env.ts";
import { shellQuote } from "./shell.ts";
import {
  TARGET_APP_ENV_PATH,
  provisionTargetAppEnv,
} from "./target-app-env.ts";

const INNER_RUNTIMES_ACTION_ID = "niceeval-eval.prepare-inner-runtimes.v5";
const HARNESS_SEED_ACTION_ID = "niceeval-eval.upload-harness-seed";
const HARNESS_CANDIDATE_ACTION_ID = "niceeval-eval.install-candidate-and-prepare-workspace";
const RUNTIME_CONTRACT_ACTION_ID = "niceeval-eval.runtime-contract";
const AGENT_ENDPOINT_COMMAND_ID = "niceeval-eval.instabox-agent-endpoint";

const NODE_RUNTIME_SOURCE =
  "niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96";
const PYTHON_RUNTIME_SOURCE =
  "python:3.11.9-bookworm@sha256:c95170ff7d59de63e9445d3d503644a635c1b8cb7f4fa99f19a1c76da92a849a";

// 沙箱里预装的 Codex CLI。与 NiceEval codexAgent 锁定的版本一致时 Agent ensure 直接命中，
// 不一致时 Adapter 会自己安装锁定版本——预装只是省时间，不是正确性前提。
const CODEX_CLI_VERSION = "0.167.2";

/** 读取 sandbox/scripts/ 下的脚本，并在前面定义它要用的 shell 变量。 */
function script(name: string, variables: Record<string, string>): string {
  const assignments = Object.entries(variables).map(([key, value]) => `${key}=${shellQuote(value)}\n`).join("");
  return assignments + readFileSync(new URL(`../sandbox/scripts/${name}`, import.meta.url), "utf8");
}

loadRepoEnv();
const AGENT_BASE_URL = process.env.CODEX_BASE_URL?.trim()
  || process.env.NICEEVAL_INSTABOX_CODEX_BASE_URL?.trim()
  || "https://s2a.niceeval.com/v1";

export function sandboxCodexAgent() {
  return codexAgent({ baseUrl: AGENT_BASE_URL });
}

/**
 * 准备沙箱基础工具链（Node 24、pnpm、安全凭据目录）并准备 inner runtime Docker 镜像。
 */
function prepareInnerRuntimes() {
  return shell({
    id: INNER_RUNTIMES_ACTION_ID,
    command: script("prepare-inner-runtimes.sh", {
      codex_version: CODEX_CLI_VERSION,
      node_source: NODE_RUNTIME_SOURCE,
      python_source: PYTHON_RUNTIME_SOURCE,
    }),
    user: "root",
    changeFrequency: changeFrequency.rare + 1,
  });
}

/**
 * 候选安装、init、生成物清理、只读依赖树和 workspace/home 物化都由 Harness 的 TS layer
 * 明确拥有。它们在 inner runtime 准备后执行，并可随 rootfs 前缀一起缓存。
 */
function installCandidateAndPrepareWorkspace(candidateVersion: string) {
  return shell({
    id: HARNESS_CANDIDATE_ACTION_ID,
    command: script("install-candidate.sh", { candidate_version: candidateVersion }),
    user: "root",
    changeFrequency: changeFrequency.rare + 2,
    dependsOn: [actionRef(INNER_RUNTIMES_ACTION_ID), actionRef(HARNESS_SEED_ACTION_ID)],
  });
}

/** 不缓存的运行边界：每个 clone 检查已有运行契约。 */
function assertRuntime(candidateVersion?: string) {
  return defineSandboxCommand({
    id: RUNTIME_CONTRACT_ACTION_ID,
    revision: "instabox-runtime-direct-1",
    inputs: { candidateVersion: candidateVersion ?? null },
    changeFrequency: changeFrequency.rare + (candidateVersion === undefined ? 1 : 3),
    dependsOn: [actionRef(candidateVersion === undefined ? INNER_RUNTIMES_ACTION_ID : HARNESS_CANDIDATE_ACTION_ID)],
  }, async (sandbox, context) => {
    context.progress({ message: "检查沙箱运行环境契约" });
    const checked = await sandbox.runShell(script("runtime-contract.sh", candidateVersion === undefined ? {} : { candidate_version: candidateVersion }), { signal: context.signal });
    if (checked.exitCode !== 0) throw new Error(`Instabox runtime contract failed: ${checked.stderr}`);
  });
}

/**
 * 目标应用凭据不能进入缓存 action。此 callback 每次真实执行，
 * 频率 1000 让固定 runtime 与 fixture 前缀排在它之前。
 */
const provisionTargetAppCommand = defineSandboxCommand(
  {
    id: "niceeval-eval.target-app-env",
    revision: "5",
    inputs: { path: TARGET_APP_ENV_PATH },
    changeFrequency: changeFrequency.frequent,
  },
  async (sandbox, context) => {
    await provisionTargetAppEnv(sandbox, context);
  },
);

/** 使用既有公网 TLS 模型入口，在 Agent 启动前验证鉴权边界。 */
const provisionAgentEndpointCommand = defineSandboxCommand(
  {
    id: AGENT_ENDPOINT_COMMAND_ID,
    revision: "3",
    inputs: { baseUrl: AGENT_BASE_URL },
    changeFrequency: changeFrequency.frequent,
    dependsOn: [actionRef(RUNTIME_CONTRACT_ACTION_ID)],
  },
  async (sandbox, context) => {
    context.progress({ message: "验证 Instabox Agent TLS endpoint" });
    const cfId = process.env.CF_ACCESS_CLIENT_ID?.trim();
    const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET?.trim();
    const cfHeaders = cfId && cfSecret ? [
      "-H", `CF-Access-Client-Id: ${cfId}`,
      "-H", `CF-Access-Client-Secret: ${cfSecret}`,
    ] : [];
    const probe = await sandbox.runCommand("curl", [
      "--proto", "=https",
      "--tlsv1.2",
      "--connect-timeout", "5",
      "--max-time", "15",
      "--silent",
      "--show-error",
      ...cfHeaders,
      "--output", "/dev/null",
      "--write-out", "%{http_code}",
      `${AGENT_BASE_URL.replace(/\/+$/u, "")}/models`,
    ]);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== "401") {
      throw new Error(
        `Instabox Agent endpoint 未就绪：curl exit=${probe.exitCode} http=${probe.stdout.trim() || "none"}`,
      );
    }
    context.progress({ message: "Instabox Agent 专用 TLS endpoint 已就绪" });
  },
);


/** 每个 Attempt 请求独立 Instabox 实例和有限 TTL。 */
function attemptSandbox() {
  return instaboxSandbox({
    templateId: "universal",
    lifetimeMs: 90 * 60 * 1000,
    spec: "instabox-medium",
    pathPrepend: ["/opt/niceeval-toolchain/bin"],
  });
}

/** 从零安装题保留 guest Docker；凭据在缓存准备完成后逐 Attempt 写入。 */
export function installSandbox() {
  loadRepoEnv();
  return attemptSandbox()
    .before(prepareInnerRuntimes())
    .before(assertRuntime())
    .before(provisionAgentEndpointCommand)
    .before(provisionTargetAppCommand);
}

/** Harness 的 inner runtime、seed、候选安装和 workspace 可缓存；运行态按 Attempt 创建。 */
export function harnessSandbox(candidateVersion: string) {
  loadRepoEnv();
  return attemptSandbox()
    .before(prepareInnerRuntimes())
    .before(uploadDirectory({
      id: HARNESS_SEED_ACTION_ID,
      source: new URL("../sandbox/harness-project/", import.meta.url),
      to: "/data/home/niceeval-harness-seed",
      changeFrequency: changeFrequency.rare + 1,
      dependsOn: [actionRef(INNER_RUNTIMES_ACTION_ID)],
    }))
    .before(installCandidateAndPrepareWorkspace(candidateVersion))
    .before(assertRuntime(candidateVersion))
    .before(provisionAgentEndpointCommand);
}
