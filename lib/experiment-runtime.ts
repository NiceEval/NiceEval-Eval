/** Instabox 普通执行路径：每 Attempt 独立实例，实际检查 Docker/Compose。
 * 基础镜像使用 Instabox universal 模板，BeforeCache 自动保存和恢复远端快照。
 */

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
    command: `set -eu
printf '%s\\n' '初始化沙箱 Node 24 与固定 pnpm toolchain…'
rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
curl -fsSL https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz | tar -xJf - -C /usr/local --strip-components=1
mkdir -p /opt/niceeval-toolchain/bin
corepack enable --install-directory /opt/niceeval-toolchain/bin
ln -sf /opt/niceeval-toolchain/bin/pnpm /usr/local/bin/pnpm
ln -sf /opt/niceeval-toolchain/bin/pnpx /usr/local/bin/pnpx
corepack prepare pnpm@11.12.0 --activate
box_user="$(id -un 1000 2>/dev/null || id -un)"
box_home="$(eval echo "~$box_user")"
setpriv --reuid="$box_user" --regid="$box_user" --init-groups env HOME="$box_home" corepack prepare pnpm@11.12.0 --activate 2>/dev/null || true
mkdir -p /opt/fixture-secrets
chown -R "$box_user:$box_user" /opt/fixture-secrets

printf '%s\\n' '在基础镜像中预安装官方 Codex CLI 0.167.2…'
npm install -g @openai/codex@0.167.2
mkdir -p "$box_home/.local/bin"
ln -sf /usr/local/bin/codex "$box_home/.local/bin/codex"
chown -R "$box_user:$box_user" "$box_home/.local"

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

printf '%s\\n' '拉取固定 digest 的 inner runtime sources…'
pull_fixed "$node_source"
pull_fixed "$python_source"
docker image tag "$node_source" "$node_tag"

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

cleanup
trap - EXIT

printf '%s\\n' '沙箱基础环境与 inner runtime 镜像准备完成'`,
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
    command: `set -eu
candidate_version=${shellQuote(candidateVersion)}
seed=/data/home/niceeval-harness-seed
scratch=/opt/niceeval-harness
project="$scratch/project"
modules="$scratch/node_modules"
store="$scratch/pnpm-store"
workspace=/data/home/workspace

test -d "$seed"
rm -rf "$scratch"
mkdir -p "$project" "$store"
cp -a "$seed/." "$project/"

# pnpm 11 的 minimumReleaseAge 默认策略会拦截刚发布的候选；被测对象不受包年龄限制。
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
box_user="$(id -un 1000 2>/dev/null || id -un)"
box_group="$(id -gn "$box_user" 2>/dev/null || id -gn)"
chown -R "$box_user:$box_group" "$workspace"

printf 'harness 候选就绪：niceeval@%s\n' "$candidate_version"`,
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
    const checked = await sandbox.runShell(runtimeContractScript(candidateVersion), { signal: context.signal });
    if (checked.exitCode !== 0) throw new Error(`Instabox runtime contract failed: ${checked.stderr}`);
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
project_cli_version="$(NODE_NO_WARNINGS=1 pnpm --silent exec niceeval --version 2>/dev/null || pnpm exec niceeval --version)" || \
  fail "workspace 项目内 niceeval 命令不可用：niceeval@$candidate_version"
[ "$project_cli_version" = "$candidate_version" ] || \
  fail "workspace 项目内 niceeval 命令版本不符：期望 $candidate_version，实测 $project_cli_version"
[ ! -e src ] || fail "候选准备 action 错误地物化了 case 源码（niceeval@$candidate_version）"`;

  return `set -eu
fail() { printf '%s\\n' "$1" >&2; exit 1; }

node_version="$(node -v 2>&1)" || fail "sandbox Node 不可用"
case "$node_version" in v24.*) ;; *) fail "sandbox Node 必须是 v24.x，实测 $node_version" ;; esac

user_id="$(id -u 2>&1)" || fail "无法读取受管命令 uid"
[ "$user_id" = "1000" ] || fail "受管命令必须以普通用户(uid 1000) 执行，实测 $user_id"

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
