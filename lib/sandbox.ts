/**
 * Instabox 沙箱的准备步骤。每一步是一个 `.before()` action，按书写顺序执行，内容变了只重做这一步及之后；
 * 可缓存的步骤由 Instabox 远端快照复用。minimal 模板提供 Node 22、Python 3、git 与 curl；这里补齐
 * Docker/Compose、Python 工具、Node 24、pnpm 与锁定的 Codex CLI。Experiment 文件继续追加各族的准备步骤。
 */

import { codexAgent } from "niceeval/adapter";
import { changeFrequency, command, defineSandboxCommand, instaboxSandbox, shell, uploadDirectory } from "niceeval/sandbox";
import { cloudflareAccessHeaders, loadRepoEnv } from "./env.ts";
import { TARGET_APP_ENV_PATH, provisionTargetAppEnv } from "./target-app-env.ts";

loadRepoEnv();
const AGENT_BASE_URL = process.env.CODEX_BASE_URL?.trim()
  || process.env.NICEEVAL_INSTABOX_CODEX_BASE_URL?.trim()
  || "https://s2a.niceeval.com/v1";

export function sandboxCodexAgent() {
  return codexAgent({ baseUrl: AGENT_BASE_URL, headers: cloudflareAccessHeaders() });
}

/**
 * 每个 Attempt 一台 Instabox minimal 实例，稳定工具链排在候选与运行时凭据之前，供远端快照复用。
 * 先删掉模板自带的 npm 10 与 corepack：直接解压覆盖会混出跑不起来的 npm，内置 Codex 安装器靠 npm 安装锁定版本。
 */
export const instabox = instaboxSandbox({
  templateId: "minimal",
  lifetimeMs: 90 * 60 * 1000,
  spec: "instabox-medium",
}).before(shell({
  id: "minimal-system-tools",
  user: "root",
  changeFrequency: changeFrequency.rare,
  script: new URL("../fixtures/sandbox/prepare-system.sh", import.meta.url),
})).before(shell({
  id: "node-24",
  user: "root",
  changeFrequency: changeFrequency.rare,
  command: "rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack && curl -fsSL https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz | tar -xJf - -C /usr/local --strip-components=1",
})).before(shell({
  id: "pnpm-12-20-0",
  user: "root",
  changeFrequency: changeFrequency.rare,
  // minimal 模板的 npmrc 把全局前缀设为 /opt/npm，其 bin 只经登录 shell 的 profile.d 进入 PATH；
  // command()/runCommand() 直接 spawn，找不到那里的 pnpm（spawn pnpm ENOENT）。装进 /usr/local/bin。
  command: "npm install --global --prefix /usr/local pnpm@12.20.0 && /usr/local/bin/pnpm --version",
})).before(shell({
  // 预装内置 Codex Agent 锁定的 CLI，让 agent.install 的探测直接命中；装在 before 里才进 snapshot，被所有 Attempt 共享。
  // 不预装时每个 Attempt 都要从宿主上传约 320 MB 的原生二进制（约 10 分钟）。NiceEval 改了锁定版本时探测未命中，回退到它自己的安装，只是变慢。
  id: "codex-cli-0.167.2",
  user: "root",
  changeFrequency: changeFrequency.rare,
  command: "set -eu; d=$(mktemp -d); curl -fsSL https://registry.npmjs.org/@openai/codex/-/codex-0.167.2-linux-x64.tgz -o \"$d/codex.tgz\"; echo \"7df4309f609f12a534817e1eb63a2e8e7ac20797  $d/codex.tgz\" | sha1sum -c -; rm -rf /usr/local/lib/codex; mkdir -p /usr/local/lib/codex; tar -xzf \"$d/codex.tgz\" -C /usr/local/lib/codex --strip-components=1; rm -rf \"$d\"; bin=/usr/local/lib/codex/vendor/x86_64-unknown-linux-musl/bin/codex; chmod +x \"$bin\"; ln -sfn \"$bin\" /usr/local/bin/codex; ln -sfn \"$bin\" /usr/local/bin/apply_patch; codex --version",
}));

/** Harness：上传项目 seed 到 workspace。 */
export const harnessProject = uploadDirectory({
  id: "harness-project",
  source: new URL("../sandbox/harness-project/", import.meta.url),
  to: ".",
});

/**
 * Harness：安装候选版本。pnpm 默认拦截刚发布的包，被测版本不受包年龄限制。
 * action id 带版本号：各候选在同一位置装不同版本，同一个 id 会让它们的快照互相取代。
 */
export function installCandidate(candidateVersion: string) {
  return command("pnpm", ["add", "-D", `niceeval@${candidateVersion}`], {
    id: `niceeval-candidate-${candidateVersion}`,
    env: { npm_config_minimum_release_age: "0" },
  });
}

/** Harness：运行 niceeval init，拿到这个版本的项目指引。 */
export const niceevalInit = command("pnpm", ["exec", "niceeval", "init"], { id: "niceeval-init" });

/** Harness：删掉 init 生成的示例源码；题目源码由各 Eval 的 fixture 上传。 */
export const removeInitExamples = command(
  "rm", ["-rf", "agents", "config", "docs", "evals", "experiments", "src"],
  { id: "remove-init-examples" },
);

/**
 * 题内 inner dockerd 用的镜像，各 fixture 按同一个 digest 引用；预先拉取进快照，Attempt 里不再访问 registry。
 * 拉取与候选版本无关，标为 rare 排在 `pnpm add niceeval@<版本>` 之前，三个候选共用这段快照前缀。
 */
export const INNER_NODE_IMAGE =
  "niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96";
export const INNER_PYTHON_IMAGE =
  "python:3.11.9-bookworm@sha256:c95170ff7d59de63e9445d3d503644a635c1b8cb7f4fa99f19a1c76da92a849a";
export const pullInnerNodeImage = command("docker", ["pull", INNER_NODE_IMAGE], { id: "pull-inner-node-image", changeFrequency: changeFrequency.rare });
export const pullInnerPythonImage = command("docker", ["pull", INNER_PYTHON_IMAGE], { id: "pull-inner-python-image", changeFrequency: changeFrequency.rare });

/** 安装题：目标应用凭据文件所在目录，归普通用户（uid 1000）。 */
export const targetAppSecretsDir = command(
  "install", ["-d", "-o", "1000", "-g", "1000", "/opt/fixture-secrets"],
  { id: "target-app-secrets-dir", user: "root" },
);

/** 安装题：每个 Attempt 写入目标应用的 LLM 凭据。凭据不进入缓存，所以是每次真实执行的 callback。 */
export const targetAppEnv = defineSandboxCommand(
  {
    id: "target-app-env",
    revision: "1",
    inputs: { path: TARGET_APP_ENV_PATH },
    changeFrequency: changeFrequency.frequent,
  },
  async (sandbox, context) => {
    await provisionTargetAppEnv(sandbox, context);
  },
);

/** Agent 启动前确认网关就绪（未鉴权请求应得到 401）。带 Cloudflare Access 凭据，所以是每次真实执行的 callback。 */
export const agentEndpointCheck = defineSandboxCommand(
  {
    id: "agent-endpoint",
    revision: "1",
    inputs: { baseUrl: AGENT_BASE_URL },
    changeFrequency: changeFrequency.frequent,
  },
  async (sandbox, context) => {
    context.progress({ message: "检查被测 Codex 的模型网关" });
    const cfHeaders = Object.entries(cloudflareAccessHeaders()).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
    const probe = await sandbox.runCommand("curl", [
      "--proto", "=https", "--tlsv1.2", "--connect-timeout", "5", "--max-time", "15",
      "--silent", "--show-error", ...cfHeaders,
      "--output", "/dev/null", "--write-out", "%{http_code}",
      `${AGENT_BASE_URL.replace(/\/+$/u, "")}/models`,
    ]);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== "401") {
      throw new Error(`被测 Codex 的模型网关未就绪：curl exit=${probe.exitCode} http=${probe.stdout.trim() || "none"}`);
    }
  },
);
