/**
 * 各实验共用的 Incus VM sandbox 装配。
 *
 * 单个评估 Attempt 得到一台一次性 Incus VM：guest 工作空间跑 coding agent 与 Eval，
 * guest 内普通 dockerd 提供 Docker-in-disposable-VM。V1 是 DestroyOnly，不发布
 * sandboxState.dockerData，NiceEval 会拒绝 --keep-sandbox。
 *
 * Experiment 使用 `incusSandbox({ image, project, storagePool, resources,
 * acceptDevelopmentDomain })`。本机 dogfood 默认 development exact pair
 * `niceeval-eval-dev` / `niceeval-sandbox-dev`，并显式 `acceptDevelopmentDomain: true`；
 * 结果 non-comparable，不能当成 reference 通过。reference exact pair 是
 * `niceeval-eval` / `niceeval-evals`。
 *
 * NiceEval 不 build / import / pull Incus base，也不接受 `ubuntu:latest` 一类可变引用；这里直接
 * 固定 it-infra 已部署并信任的通用 `niceeval-eval-base@sha256:...`。业务 runtime、Harness seed
 * 与候选安装由声明式 before action 构建，Run-level Incus prepare 再逐层发布可复用 artifact。
 * 精确候选版本由下方声明式 action 安装并物化；case repo 由所属 Eval 的 fixture action 写入。
 */

import { codexAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  defineSandboxCommand,
  incusSandbox,
  shell,
  uploadDirectory,
} from "niceeval/sandbox";
import { loadRepoEnv } from "./env.ts";
import {
  TARGET_APP_ENV_PATH,
  provisionTargetAppEnv,
  teardownTargetAppProxy,
} from "./target-app-env.ts";

const GIB = 1024 ** 3;

const INNER_RUNTIMES_ACTION_ID = "niceeval-eval.prepare-inner-runtimes";
const HARNESS_SEED_ACTION_ID = "niceeval-eval.upload-harness-seed";
const HARNESS_CANDIDATE_ACTION_ID = "niceeval-eval.install-candidate-and-prepare-workspace";
const RUNTIME_CONTRACT_ACTION_ID = "niceeval-eval.runtime-contract";
const AGENT_ENDPOINT_COMMAND_ID = "niceeval-eval.incus-agent-endpoint";

const NODE_RUNTIME_SOURCE =
  "niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96";
const PYTHON_RUNTIME_SOURCE =
  "python:3.11.9-bookworm@sha256:c95170ff7d59de63e9445d3d503644a635c1b8cb7f4fa99f19a1c76da92a849a";

const INCUS_BASE_IMAGE =
  "niceeval-eval-base@sha256:1d03a5168e7769da3ed78c9c9f8036e59092a15296fbc0a362da3f4d951609f3";

const DEVELOPMENT_PROJECT = "niceeval-eval-dev";
const DEVELOPMENT_STORAGE_POOL = "niceeval-sandbox-dev";
const AGENT_ENDPOINT_HOST = "sub2api.350124.xyz";
const AGENT_ENDPOINT_IP = "10.43.0.184";
const DEFAULT_INCUS_CODEX_BASE_URL = `https://${AGENT_ENDPOINT_HOST}:18443/v1`;

/**
 * Incus VM 通过只暴露 Responses API 的集群专用 TLS entrypoint 连接 Agent endpoint。
 * 这里只显式配置 base URL；不读取或传入 apiKey，让官方 adapter 在每个 Attempt
 * 中继续从 CODEX_API_KEY 取得短期鉴权。
 */
export function incusCodexAgent() {
  loadRepoEnv();
  const baseUrl = process.env.NICEEVAL_INCUS_CODEX_BASE_URL?.trim()
    || DEFAULT_INCUS_CODEX_BASE_URL;
  return codexAgent({ baseUrl });
}

/**
 * 安装题只根据对话、工具调用和最终工作区判分，不消费 Codex 的 OTLP trace。
 * 长会话能产生上百 MiB，反而挤占 attempt deadline。保留官方 adapter 的安装、
 * setup、send 和证据采集，只关闭这条非判分遥测通道。
 */
export function installCodexAgent() {
  return { ...incusCodexAgent(), tracing: undefined };
}

/**
 * 固定 digest 的 inner runtime 是业务 SetupPrefix，不属于 host base image。
 * 同一层同时发布 install/harness 需要的本地 tags，两个实验因而能复用同一 Incus artifact。
 */
function prepareInnerRuntimes() {
  return shell({
    id: INNER_RUNTIMES_ACTION_ID,
    command: `set -eu
node_source=${shellQuote(NODE_RUNTIME_SOURCE)}
python_source=${shellQuote(PYTHON_RUNTIME_SOURCE)}
node_tag=cache.invalid/niceeval-harness/runtime:node
harness_python_tag=cache.invalid/niceeval-harness/runtime:python
install_python_tag=cache.invalid/niceeval-install/runtime:python
build_dir="$(mktemp -d)"
node_container=
python_container=
cleanup() {
  [ -z "$node_container" ] || docker rm -f "$node_container" >/dev/null 2>&1 || true
  [ -z "$python_container" ] || docker rm -f "$python_container" >/dev/null 2>&1 || true
  rm -rf "$build_dir"
}
trap cleanup EXIT

printf '%s\\n' '初始化 root/node 的固定 pnpm toolchain…'
corepack prepare pnpm@11.12.0 --activate
su -s /bin/sh node -c 'corepack prepare pnpm@11.12.0 --activate'

printf '%s\\n' '拉取固定 digest 的 inner runtime sources…'
docker pull "$node_source"
docker pull "$python_source"
docker image tag "$node_source" "$node_tag"

# Generic base intentionally does not carry buildx. Recreate the previously
# imported Python rootfs with Docker's stable create/cp/export/import surface.
node_container="$(docker create "$node_source")"
python_container="$(docker create "$python_source")"
docker cp "$node_container:/usr/local/bin/node" "$build_dir/node"
docker cp "$build_dir/node" "$python_container:/usr/local/bin/node"
docker cp "$build_dir/node" "$python_container:/usr/local/bin/nodejs"
docker export "$python_container" | docker import - "$harness_python_tag"
docker image tag "$harness_python_tag" "$install_python_tag"

docker run --pull=never --rm --entrypoint /bin/sh "$node_tag" \
  -c 'node -v && git --version && ! command -v python3'
docker run --pull=never --rm --entrypoint /bin/sh "$harness_python_tag" \
  -c 'node -v && git --version && python3 --version'

printf '%s\\n' 'inner runtime tags 已由业务 SetupPrefix 准备完成'`,
    user: "root",
    changeFrequency: changeFrequency.rare,
  });
}

/**
 * 候选安装、init、生成物清理、只读依赖树和 workspace/home 物化都由 Harness 的 TS layer
 * 明确拥有。它们必须在 runtime 导入满足后逐次执行。
 */
function installCandidateAndPrepareWorkspace(candidateVersion: string) {
  return shell({
    id: HARNESS_CANDIDATE_ACTION_ID,
    command: `set -eu
candidate_version=${shellQuote(candidateVersion)}
seed=/home/node/niceeval-harness-seed
scratch=/opt/niceeval-harness
project="$scratch/project"
modules="$scratch/node_modules"
store="$scratch/pnpm-store"
workspace=/home/sandbox/workspace

test -d "$seed"
rm -rf "$scratch"
mkdir -p "$project" "$store"
cp -a "$seed/." "$project/"

# pnpm 11 的 minimumReleaseAge 默认策略会拦截刚发布的候选；被评对象不受包年龄限制。
export npm_config_minimum_release_age=0
printf '安装 harness 候选 niceeval@%s…\n' "$candidate_version"
(cd "$project" && pnpm add -D --store-dir "$store" "niceeval@$candidate_version" && pnpm exec niceeval init)

# init 只提供候选版本的项目指引；题目源码、agent、eval 与 experiment 由 case fixture 上传。
rm -rf "$project/agents" "$project/config" "$project/docs" "$project/evals" \
  "$project/experiments" "$project/src"
mkdir -p "$project/evals" "$project/experiments"

# 保留绝对 symlink 和 root 拥有的只读依赖树；清空仅供安装使用的 pnpm store 后，后续命令
# 继续使用已物化的候选依赖。Sandbox 仍保留公网访问，题内项目可按上游方式安装依赖。
mv "$project/node_modules" "$modules"
ln -s "$modules" "$project/node_modules"
rm -rf "$store"
mkdir -p "$store/v11"
chmod -R a+rX "$modules" "$store"
chmod 0700 "$project"

mkdir -p "$workspace"
cp -a "$project/." "$workspace/"
chown -R node:"$(id -gn node)" "$workspace"

printf 'harness 候选就绪：niceeval@%s\n' "$candidate_version"`,
    user: "root",
    changeFrequency: changeFrequency.rare + 2,
    dependsOn: [actionRef(INNER_RUNTIMES_ACTION_ID), actionRef(HARNESS_SEED_ACTION_ID)],
  });
}

/** guest Docker、Node/pnpm 与候选 workspace 的既有 fail-fast 契约，保留为紧随准备流程的 action。 */
function assertRuntime(candidateVersion?: string) {
  return shell({
    id: RUNTIME_CONTRACT_ACTION_ID,
    command: runtimeContractScript(candidateVersion),
    changeFrequency: changeFrequency.rare + (candidateVersion === undefined ? 1 : 3),
    dependsOn: [actionRef(
      candidateVersion === undefined ? INNER_RUNTIMES_ACTION_ID : HARNESS_CANDIDATE_ACTION_ID,
    )],
  });
}

function runtimeContractScript(candidateVersion?: string): string {
  const candidateContract = candidateVersion === undefined
    ? ""
    : `
candidate_version=${shellQuote(candidateVersion)}
test -f package.json && test -L node_modules && test -f AGENTS.md || \
  fail "workspace 缺候选项目基建、候选版 AGENTS 或 node_modules symlink：niceeval@$candidate_version action 没有完成安装/物化。"
installed_version="$(node -p "require('./node_modules/niceeval/package.json').version" 2>&1)" || \
  fail "workspace 候选版本不可读：niceeval@$candidate_version"
[ "$installed_version" = "$candidate_version" ] || \
  fail "workspace 候选版本不符：期望 niceeval@$candidate_version，实测 $installed_version"
project_cli_version="$(pnpm exec niceeval --version 2>&1)" || \
  fail "workspace 项目内 niceeval 命令不可用：niceeval@$candidate_version"
[ "$project_cli_version" = "$candidate_version" ] || \
  fail "workspace 项目内 niceeval 命令版本不符：期望 $candidate_version，实测 $project_cli_version"
[ ! -e src ] || fail "候选准备 action 错误地物化了 case 源码（niceeval@$candidate_version）"`;

  return `set -eu
fail() { printf '%s\\n' "$1" >&2; exit 1; }

node_version="$(node -v 2>&1)" || fail "sandbox Node 不可用"
case "$node_version" in v24.*) ;; *) fail "sandbox Node 必须是 v24.x，实测 $node_version" ;; esac

user_id="$(id -u 2>&1)" || fail "无法读取受管命令 uid"
[ "$user_id" = "1000" ] || fail "受管命令必须以 node(uid 1000) 执行，实测 $user_id"

pnpm_version="$(pnpm --version 2>&1)" || fail "sandbox pnpm 不可用"
[ "$pnpm_version" = "11.12.0" ] || fail "sandbox pnpm 必须是 11.12.0，实测 $pnpm_version"

docker_version="$(docker info --format '{{.ServerVersion}}' 2>&1)" || fail "guest dockerd 不可用：$docker_version"
[ -n "$docker_version" ] || fail "guest dockerd 不可用：docker info 无输出"

compose_version="$(docker compose version --short 2>&1)" || fail "docker compose 不可用：$compose_version"
[ -n "$compose_version" ] || fail "docker compose 不可用：compose version 无输出"
${candidateContract}

printf '运行基线通过：Node %s · pnpm %s · Docker %s · Compose %s\\n' \
  "$node_version" "$pnpm_version" "$docker_version" "$compose_version"`;
}

/**
 * 目标应用短期 token 不能进入声明式 action。这个带稳定调度 identity 的 callback 每次真实
 * 执行，频率 1000 让固定 runtime 与 fixture 前缀排在它之前；成功 acquire 后立即登记 cleanup。
 */
const provisionTargetAppCommand = defineSandboxCommand(
  {
    id: "niceeval-eval.target-app-env",
    revision: "3",
    inputs: { path: TARGET_APP_ENV_PATH, proxyProtocol: "target-app-incus-gateway-proxy/v3" },
    changeFrequency: changeFrequency.frequent,
  },
  async (sandbox, context) => {
    await provisionTargetAppEnv(sandbox, context);
    // 捕获同一个 facade，避免 cleanup 阶段的新 facade 破坏 helper 以对象 identity 记的 WeakMap。
    context.onCleanup(async () => {
      await teardownTargetAppProxy(sandbox);
    });
  },
);

/**
 * Agent endpoint 的地址映射是 Attempt 状态，不得进入 SetupPrefix artifact。普通
 * defineSandboxCommand callback 是缓存屏障；它在最后一个声明式 action 后重放，
 * 并在 agent.ensure 前用系统 CA 验证专用 TLS route 已经 fail-closed 地就绪。
 */
const provisionAgentEndpointCommand = defineSandboxCommand(
  {
    id: AGENT_ENDPOINT_COMMAND_ID,
    revision: "1",
    inputs: {
      host: AGENT_ENDPOINT_HOST,
      ip: AGENT_ENDPOINT_IP,
      baseUrl: DEFAULT_INCUS_CODEX_BASE_URL,
    },
    changeFrequency: changeFrequency.frequent,
    dependsOn: [actionRef(RUNTIME_CONTRACT_ACTION_ID)],
  },
  async (sandbox, context) => {
    context.progress({ message: "验证 Incus Agent 专用 TLS endpoint" });
    await sandbox.runShellOrThrow(
      `set -eu
host=${shellQuote(AGENT_ENDPOINT_HOST)}
ip=${shellQuote(AGENT_ENDPOINT_IP)}
tmp="$(mktemp)"
awk -v host="$host" '
  {
    keep = 1
    for (i = 2; i <= NF; i++) if ($i == host) keep = 0
    if (keep) print
  }
' /etc/hosts > "$tmp"
printf '%s\\t%s\\n' "$ip" "$host" >> "$tmp"
cat "$tmp" > /etc/hosts
rm -f "$tmp"`,
      { user: "root" },
    );

    const lookup = await sandbox.runCommandOrThrow("getent", ["ahostsv4", AGENT_ENDPOINT_HOST]);
    const resolved = lookup.stdout.trim().split(/\s+/u);
    if (!resolved.includes(AGENT_ENDPOINT_IP)) {
      throw new Error(
        `Incus Agent endpoint 解析不符：期望 ${AGENT_ENDPOINT_IP}，实测 ${lookup.stdout.trim()}`,
      );
    }

    const probe = await sandbox.runCommand("curl", [
      "--proto", "=https",
      "--tlsv1.2",
      "--connect-timeout", "5",
      "--max-time", "15",
      "--silent",
      "--show-error",
      "--output", "/dev/null",
      "--write-out", "%{http_code}",
      `https://${AGENT_ENDPOINT_HOST}:18443/v1/models`,
    ]);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== "401") {
      throw new Error(
        `Incus Agent endpoint 未就绪：curl exit=${probe.exitCode} http=${probe.stdout.trim() || "none"}`,
      );
    }
    context.progress({ message: "Incus Agent 专用 TLS endpoint 已就绪" });
  },
);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 每 Attempt 限 1 CPU / 4 GiB 内存 / 4 GiB Docker data。V1 DestroyOnly。
 * 本机 dogfood 固定 development domain，并显式接受 non-comparable。
 */
function incusAttemptSandbox(image: string) {
  return incusSandbox({
    image,
    project: DEVELOPMENT_PROJECT,
    storagePool: DEVELOPMENT_STORAGE_POOL,
    resources: {
      cpus: 1,
      memoryBytes: 4 * GIB,
      dockerDataBytes: 4 * GIB,
    },
    acceptDevelopmentDomain: true,
  });
}

/** 从零安装题保留 guest Docker。短期凭证 callback 仍以频率 1000 最后执行并登记 cleanup。 */
export function installSandbox() {
  loadRepoEnv();
  return incusAttemptSandbox(INCUS_BASE_IMAGE)
    .before(prepareInnerRuntimes())
    .before(assertRuntime())
    .before(provisionAgentEndpointCommand)
    .before(provisionTargetAppCommand);
}

/** Harness 的 runtime、seed、候选安装和 workspace 都成为可复用的业务准备层。 */
export function harnessSandbox(candidateVersion: string) {
  loadRepoEnv();
  return incusAttemptSandbox(INCUS_BASE_IMAGE)
    .before(prepareInnerRuntimes())
    .before(uploadDirectory({
      id: HARNESS_SEED_ACTION_ID,
      source: new URL("../sandbox/harness-project/", import.meta.url),
      to: "/home/node/niceeval-harness-seed",
      changeFrequency: changeFrequency.rare + 1,
      dependsOn: [actionRef(INNER_RUNTIMES_ACTION_ID)],
    }))
    .before(installCandidateAndPrepareWorkspace(candidateVersion))
    .before(assertRuntime(candidateVersion))
    .before(provisionAgentEndpointCommand);
}
