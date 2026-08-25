/**
 * 各实验共用的 Docker-in-Docker sandbox 装配。
 *
 * 单个评估容器同时承载 coding agent 和内层 dockerd；agent 以 node 身份执行，但能通过
 * 同容器 Unix socket 使用 docker / docker compose。全部实验显式授权 raw privileged DinD，
 * 只适用于一次性 VM 或专用 runner，不把外层宿主当作不可信代码的安全隔离边界。
 *
 * 使用当前 niceeval/sandbox 的 Dockerfile source 构造：
 * `dockerSandbox({ source: { type: "dockerfile", ... } })`。
 *
 * context 是仓库根，.dockerignore 把 context 白名单收窄到 sandbox/。Harness 镜像只携带
 * 固定 seed 与离线 runtime；精确候选版本由下方声明式 action 安装并物化到 attempt tmpfs。
 * install 使用不含 Harness seed 与候选依赖的专用 target。case repo 不进 build context，
 * 由所属 Eval 的 fixture action 写入准备链。
 */

import { codexAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  defineSandboxCommand,
  dockerSandbox,
  sandboxState,
  shell,
} from "niceeval/sandbox";
import {
  TARGET_APP_ENV_PATH,
  provisionTargetAppEnv,
  teardownTargetAppProxy,
} from "./target-app-env.ts";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const HARNESS_RUNTIME_IMPORT_ACTION_ID = "niceeval-eval.import-inner-runtimes";
const HARNESS_CANDIDATE_ACTION_ID = "niceeval-eval.install-candidate-and-prepare-workspace";
const RUNTIME_CONTRACT_ACTION_ID = "niceeval-eval.runtime-contract";

/**
 * 安装题只根据对话、工具调用和最终工作区判分，不消费 Codex 的 OTLP trace。Docker 的只读
 * rootfs 会让 collector 通过 shell/base64 搬运 trace；长会话能产生上百 MiB，反而挤占 attempt
 * deadline。保留官方 adapter 的安装、setup、send 和证据采集，只关闭这条非判分遥测通道。
 */
export function installCodexAgent() {
  return { ...codexAgent(), tracing: undefined };
}

/**
 * 两枚固定 inner runtime 只写 inner Docker data-root；把它单独声明成 dockerData action，
 * profile setup-prefix 才能安全复用导入结果而不假装同时捕获 workspace、home 或其它 tmpfs。
 */
function importHarnessRuntimes() {
  return shell({
    id: HARNESS_RUNTIME_IMPORT_ACTION_ID,
    command: `set -eu
runtime_dir=/opt/niceeval-harness/runtime

if [ ! -d "$runtime_dir" ]; then
  printf '%s\n' "没有离线 runtime 归档目录（$runtime_dir），跳过导入" >&2
  exit 0
fi

cd "$runtime_dir"
sha256sum -c runtime-node.tar.gz.sha256
sha256sum -c runtime-python.tar.gz.sha256

for variant in node python; do
  archive="runtime-$variant.tar.gz"
  tag="offline.invalid/niceeval-harness/runtime:$variant"
  printf '导入 inner runtime:%s（%s）…\n' "$variant" "$archive"
  docker import "$archive" "$tag"
done

docker run --pull=never --rm --entrypoint /bin/sh \
  offline.invalid/niceeval-harness/runtime:node \
  -c 'node -v && git --version && ! command -v python3'
docker run --pull=never --rm --entrypoint /bin/sh \
  offline.invalid/niceeval-harness/runtime:python \
  -c 'node -v && git --version && python3 --version'

printf '%s\n' 'inner runtime 就绪：offline.invalid/niceeval-harness/runtime:{node,python}'`,
    user: "root",
    changeFrequency: changeFrequency.rare,
    cache: { state: sandboxState.dockerData },
  });
}

/**
 * 候选安装、init、生成物清理、只读依赖树和 workspace/home 物化都由 Harness 的 TS layer
 * 明确拥有。它们位于 attempt 私有 tmpfs，必须在 runtime 导入满足后逐次执行；省略
 * cache.state 即保留默认 all，不能并入只捕获 Docker data-root 的前缀。
 */
function installCandidateAndPrepareWorkspace(candidateVersion: string) {
  return shell({
    id: HARNESS_CANDIDATE_ACTION_ID,
    command: `set -eu
candidate_version=${shellQuote(candidateVersion)}
seed=/opt/niceeval-harness-seed
scratch=/tmp/niceeval-harness
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

# 保留绝对 symlink 和 root 拥有的只读依赖树；清空仅供安装使用的 pnpm store 后，pnpm exec
# 仍能完全离线运行候选 CLI。
mv "$project/node_modules" "$modules"
ln -s "$modules" "$project/node_modules"
rm -rf "$store"
mkdir -p "$store/v11"
chmod -R a+rX "$modules" "$store"
chmod 0700 "$project"

cp -a /opt/niceeval-node-home/. /home/node/
chown -R node:node /home/node

mkdir -p "$workspace"
cp -a "$project/." "$workspace/"
chown -R node:node "$workspace"

printf 'harness 候选就绪：niceeval@%s\n' "$candidate_version"`,
    user: "root",
    changeFrequency: changeFrequency.rare + 1,
    dependsOn: [actionRef(HARNESS_RUNTIME_IMPORT_ACTION_ID)],
  });
}

/** DinD、Node/pnpm 与候选 workspace 的既有 fail-fast 契约，保留为紧随准备流程的 action。 */
function assertRuntime(candidateVersion?: string) {
  return shell({
    id: RUNTIME_CONTRACT_ACTION_ID,
    command: runtimeContractScript(candidateVersion),
    changeFrequency: changeFrequency.rare + (candidateVersion === undefined ? 1 : 2),
    ...(candidateVersion === undefined
      ? { cache: { state: sandboxState.dockerData } }
      : {}),
    ...(candidateVersion === undefined
      ? {}
      : { dependsOn: [actionRef(HARNESS_CANDIDATE_ACTION_ID)] }),
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

docker_version="$(docker info --format '{{.ServerVersion}}' 2>&1)" || fail "同容器 inner dockerd 不可用：$docker_version"
[ -n "$docker_version" ] || fail "同容器 inner dockerd 不可用：docker info 无输出"

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
    revision: "2",
    inputs: { path: TARGET_APP_ENV_PATH, proxyProtocol: "target-app-loopback-sidecar/v2" },
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * rootfs 只读；工作区等小型可写路径落到有大小上限的 tmpfs。`/tmp`
 * 允许执行 package-manager postinstall 物化的本地工具，仍由 2 GiB 容量限制控制写入。inner `/var/lib/docker`
 * 由宿主 storage profile 授予磁盘 backed、project-quota 限额的私有分配，不再占用 shmem。
 * memoryBytes 同时禁止额外 swap，单 attempt 也无法把共享外层 data-root 写满。
 * 每 Attempt 限 1 CPU / 4 GiB。宿主 checkout 与 Codex session 都落在 tmpfs；原 1536 MiB 上限会在
 * 长安装对话里把 app-server 以 exit 137 杀掉。整批吞吐另由仓库级并发上限约束。
 * 带 tmpfs 的 provider 能力是 DestroyOnly，NiceEval 会拒绝 --keep-sandbox。
 *
 * 两类正式运行复用同一份 raw DinD 资源与 readiness 契约，但选择不同 Dockerfile target。
 */
function rawDindBase(source: {
  target: "install" | "harness-candidate";
}) {
  return dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../", import.meta.url),
      file: "sandbox/Dockerfile",
      target: source.target,
    },
    user: "node",
    dockerAccess: { mode: "dind", isolation: "raw-privileged", storageProfile: "harness-raw" },
    resources: {
      cpus: 1,
      memoryBytes: 4 * GIB,
      pidsLimit: 2048,
      dockerDataBytes: 4 * GIB,
      readOnlyRootfs: true,
      tmpfs: {
        "/home/sandbox/workspace": {
          sizeBytes: 4 * GIB,
          mode: 0o755,
          uid: 1000,
          gid: 1000,
          executable: true,
        },
        "/home/node": { sizeBytes: 2 * GIB, mode: 0o700, uid: 1000, gid: 1000 },
        "/tmp": {
          sizeBytes: 2 * GIB,
          mode: 0o1777,
          uid: 0,
          gid: 0,
          executable: true,
        },
        "/run": { sizeBytes: 128 * MIB, mode: 0o755, uid: 0, gid: 0 },
        "/root": { sizeBytes: 64 * MIB, mode: 0o700, uid: 0, gid: 0 },
        "/opt/fixture-secrets": { sizeBytes: 16 * MIB, mode: 0o700, uid: 1000, gid: 1000 },
      },
    },
    readiness: {
      command: ["docker", "info"],
      user: "node",
      timeoutMs: 30_000,
    },
  });
}

/**
 * 从零安装题保留真实 DinD。Eval 拥有的 runtime import 会先形成 dockerData 前缀；这里的
 * 只读 runtime contract 不打断该前缀，checkout 才是第一个 all barrier。短期凭证 callback
 * 仍以频率 1000 最后执行并登记 cleanup。
 */
export function installSandbox() {
  return rawDindBase({ target: "install" })
    .before(assertRuntime())
    .before(provisionTargetAppCommand);
}

/** Harness 保留候选安装、两枚离线 runtime、workspace/home all barrier 与 runtime contract。 */
export function harnessSandbox(candidateVersion: string) {
  return rawDindBase({ target: "harness-candidate" })
    .before(importHarnessRuntimes())
    .before(installCandidateAndPrepareWorkspace(candidateVersion))
    .before(assertRuntime(candidateVersion));
}
