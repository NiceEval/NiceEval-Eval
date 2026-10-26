/** OpenSandbox/Kata 普通执行路径：每 Attempt 独立实例，实际检查 Docker/Compose。
 * 用户接受上游生命周期保证边界；不声明 docker/v1，rootfs 准备缓存只保存文件与镜像归档，不保留现场。
 */

import { codexAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  defineSandboxCommand,
  openSandbox,
  shell,
  uploadDirectory,
} from "niceeval/sandbox";
import { loadRepoEnv } from "./env.ts";
import {
  TARGET_APP_ENV_PATH,
  provisionTargetAppEnv,
} from "./target-app-env.ts";

const INNER_RUNTIMES_ACTION_ID = "niceeval-eval.prepare-inner-runtimes";
const HARNESS_SEED_ACTION_ID = "niceeval-eval.upload-harness-seed";
const HARNESS_CANDIDATE_ACTION_ID = "niceeval-eval.install-candidate-and-prepare-workspace";
const RUNTIME_CONTRACT_ACTION_ID = "niceeval-eval.runtime-contract";
const AGENT_ENDPOINT_COMMAND_ID = "niceeval-eval.opensandbox-agent-endpoint";

const NODE_RUNTIME_SOURCE =
  "niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96";
const PYTHON_RUNTIME_SOURCE =
  "python:3.11.9-bookworm@sha256:c95170ff7d59de63e9445d3d503644a635c1b8cb7f4fa99f19a1c76da92a849a";

const OPEN_SANDBOX_IMAGE =
  "docker.io/library/niceeval-opensandbox-docker@sha256:ecdce14703f8bf8a7e13d911f945d78e04e469e93b7cf2dca0273888b329b6cb";
loadRepoEnv();
const AGENT_BASE_URL = process.env.NICEEVAL_OPENSANDBOX_CODEX_BASE_URL?.trim()
  || "https://s2a.niceeval.com/v1";

export function sandboxCodexAgent() {
  return codexAgent({ baseUrl: AGENT_BASE_URL });
}

/**
 * 固定 digest 的 inner runtime 是业务 SetupPrefix，不属于 host base image。
 * 同一层将 install/harness 的本地 tags 导出为 rootfs 归档；每 Attempt 在 command barrier 后导入。
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
pull_fixed() {
  image="$1"
  attempt=1
  while ! docker pull "$image"; do
    if [ "$attempt" -ge 3 ]; then
      printf '固定镜像拉取连续 %s 次失败：%s\\n' "$attempt" "$image" >&2
      return 1
    fi
    delay=$((attempt * 2))
    printf '固定镜像拉取失败，%s 秒后重试（%s/3）：%s\\n' "$delay" "$attempt" "$image" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

printf '%s\\n' '初始化 root/node 的固定 pnpm toolchain…'
export DOCKER_TMPDIR=/var/tmp/niceeval-docker-transfer
mkdir -p "$DOCKER_TMPDIR"
/usr/local/bin/niceeval-docker-start
mkdir -p /opt/niceeval-toolchain/bin
corepack enable --install-directory /opt/niceeval-toolchain/bin
corepack prepare pnpm@11.12.0 --activate
setpriv --reuid=node --regid=node --init-groups env HOME=/home/node corepack prepare pnpm@11.12.0 --activate

printf '%s\\n' '拉取固定 digest 的 inner runtime sources…'
pull_fixed "$node_source"
pull_fixed "$python_source"
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

archive=/opt/niceeval-runtime-images
mkdir -p "$archive"
docker save --output "$archive/images.tar" "$node_tag" "$harness_python_tag" "$install_python_tag"
for tag in "$node_tag" "$harness_python_tag" "$install_python_tag"; do
  printf '%s %s\\n' "$tag" "$(docker image inspect --format '{{.Id}}' "$tag")"
done > "$archive/image-ids"
cleanup
trap - EXIT

# Snapshot captures rootfs only. Retire this preparation daemon and unmount its
# private tmpfs before publishing; the command barrier starts a fresh daemon.
daemon_pid="$(cat /var/run/docker.pid)"
kill "$daemon_pid"
for attempt in $(seq 1 60); do
  state="$(ps -o stat= -p "$daemon_pid" 2>/dev/null || true)"
  case "$state" in ''|Z*) break ;; esac
  sleep 1
done
state="$(ps -o stat= -p "$daemon_pid" 2>/dev/null || true)"
case "$state" in ''|Z*) ;; *) printf '%s\\n' 'preparation dockerd did not stop' >&2; exit 1 ;; esac
umount /var/lib/docker
rm -rf /var/run/docker /var/run/docker.pid /var/run/docker.sock "$DOCKER_TMPDIR"
printf '%s\\n' 'inner runtime archives 已准备完成，daemon 已停止'`,
    user: "root",
    changeFrequency: changeFrequency.rare + 1,
  });
}

/**
 * 候选安装、init、生成物清理、只读依赖树和 workspace/home 物化都由 Harness 的 TS layer
 * 明确拥有。它们在 runtime 归档准备后执行，并可随 rootfs 前缀一起缓存。
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
(cd "$project" && pnpm add -D --allow-build=autoevals --store-dir "$store" "niceeval@$candidate_version" && pnpm exec niceeval init)

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

/** 不缓存的运行边界：每个 clone 启动独立 daemon，导入归档后检查已有运行契约。 */
function assertRuntime(candidateVersion?: string) {
  return defineSandboxCommand({
    id: RUNTIME_CONTRACT_ACTION_ID,
    revision: "opensandbox-rootfs-archive-1",
    inputs: { candidateVersion: candidateVersion ?? null, archiveFormat: "docker-save/v1" },
    changeFrequency: changeFrequency.rare + (candidateVersion === undefined ? 1 : 3),
    dependsOn: [actionRef(candidateVersion === undefined ? INNER_RUNTIMES_ACTION_ID : HARNESS_CANDIDATE_ACTION_ID)],
  }, async (sandbox, context) => {
    context.progress({ message: "从准备缓存导入独立 Docker daemon" });
    const restored = await sandbox.runShell(`set -eu
export DOCKER_TMPDIR=/var/tmp/niceeval-docker-transfer
mkdir -p "$DOCKER_TMPDIR"
/usr/local/bin/niceeval-docker-start
docker load --input /opt/niceeval-runtime-images/images.tar
while read -r tag expected; do
  actual="$(docker image inspect --format '{{.Id}}' "$tag")"
  test "$actual" = "$expected"
done < /opt/niceeval-runtime-images/image-ids`, { user: "root", signal: context.signal });
    if (restored.exitCode !== 0) throw new Error(`Docker runtime archive restore failed: ${restored.stderr}`);
    const checked = await sandbox.runShell(runtimeContractScript(candidateVersion), { signal: context.signal });
    if (checked.exitCode !== 0) throw new Error(`OpenSandbox runtime contract failed: ${checked.stderr}`);
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
    revision: "4",
    inputs: { path: TARGET_APP_ENV_PATH, proxyProtocol: "target-app-kata-gateway-proxy/v4" },
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
    context.progress({ message: "验证 OpenSandbox Agent TLS endpoint" });
    const probe = await sandbox.runCommand("curl", [
      "--proto", "=https",
      "--tlsv1.2",
      "--connect-timeout", "5",
      "--max-time", "15",
      "--silent",
      "--show-error",
      "--output", "/dev/null",
      "--write-out", "%{http_code}",
      `${AGENT_BASE_URL.replace(/\/+$/u, "")}/models`,
    ]);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== "401") {
      throw new Error(
        `OpenSandbox Agent endpoint 未就绪：curl exit=${probe.exitCode} http=${probe.stdout.trim() || "none"}`,
      );
    }
    context.progress({ message: "OpenSandbox Agent 专用 TLS endpoint 已就绪" });
  },
);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** 单并发配额下，每个 Attempt 请求独立 Kata 实例和有限 TTL。 */
function attemptSandbox() {
  return openSandbox({
    image: OPEN_SANDBOX_IMAGE,
    targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
    user: "node",
    pathPrepend: ["/opt/niceeval-toolchain/bin"],
    resources: { cpu: "2", memory: "8Gi" },
    lifetimeMs: 90 * 60 * 1000,
  });
}

/** 从零安装题保留 guest Docker。短期凭证 callback 仍以频率 1000 最后执行并登记 cleanup。 */
export function installSandbox() {
  loadRepoEnv();
  return attemptSandbox()
    .before(prepareInnerRuntimes())
    .before(assertRuntime())
    .before(provisionAgentEndpointCommand)
    .before(provisionTargetAppCommand);
}

/** Harness 的 runtime 归档、seed、候选安装和 workspace 可缓存；运行态按 Attempt 创建。 */
export function harnessSandbox(candidateVersion: string) {
  loadRepoEnv();
  return attemptSandbox()
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
