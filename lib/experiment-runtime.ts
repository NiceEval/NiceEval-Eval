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
 * 镜像 locator 必须是 `name@sha256:<64 lowercase hex>`。本轮不 build / import / pull。
 * 未配置时使用全零 digest 的 unconfigured locator，只为让 Experiment 定义可加载，
 * `niceeval list` 可以成功；planning / dry 因镜像未受信而 fail-closed。用
 * `NICEEVAL_INCUS_INSTALL_IMAGE` / `NICEEVAL_INCUS_HARNESS_IMAGE` 覆盖为真实受信 digest。
 * install 与 harness 使用各自 digest-pinned locator。精确候选版本由下方声明式 action
 * 安装并物化；case repo 由所属 Eval 的 fixture action 写入准备链。
 */

import { codexAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  defineSandboxCommand,
  incusSandbox,
  shell,
} from "niceeval/sandbox";
import { loadRepoEnv } from "./env.ts";
import {
  TARGET_APP_ENV_PATH,
  provisionTargetAppEnv,
  teardownTargetAppProxy,
} from "./target-app-env.ts";

const GIB = 1024 ** 3;

const HARNESS_RUNTIME_IMPORT_ACTION_ID = "niceeval-eval.import-inner-runtimes";
const HARNESS_CANDIDATE_ACTION_ID = "niceeval-eval.install-candidate-and-prepare-workspace";
const RUNTIME_CONTRACT_ACTION_ID = "niceeval-eval.runtime-contract";

const UNCONFIGURED_IMAGE_DIGEST = "0".repeat(64);
const DIGEST_PINNED_IMAGE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?@sha256:[a-f0-9]{64}$/u;

const DEVELOPMENT_PROJECT = "niceeval-eval-dev";
const DEVELOPMENT_STORAGE_POOL = "niceeval-sandbox-dev";

/**
 * 安装题只根据对话、工具调用和最终工作区判分，不消费 Codex 的 OTLP trace。
 * 长会话能产生上百 MiB，反而挤占 attempt deadline。保留官方 adapter 的安装、
 * setup、send 和证据采集，只关闭这条非判分遥测通道。
 */
export function installCodexAgent() {
  return { ...codexAgent(), tracing: undefined };
}

function digestPinnedImage(
  envName: "NICEEVAL_INCUS_INSTALL_IMAGE" | "NICEEVAL_INCUS_HARNESS_IMAGE",
  unconfiguredName: string,
): string {
  const configured = process.env[envName]?.trim();
  const locator = configured === undefined || configured === ""
    ? `${unconfiguredName}@sha256:${UNCONFIGURED_IMAGE_DIGEST}`
    : configured;
  if (!DIGEST_PINNED_IMAGE.test(locator)) {
    throw new Error(
      `${envName} 必须是 digest-pinned locator name@sha256:<64 lowercase hex>，实际 ${JSON.stringify(locator)}`,
    );
  }
  return locator;
}

/**
 * 两枚固定 inner runtime 只写入 guest 私有 Docker data disk。V1 DestroyOnly，
 * 不把 dockerData 发布成可缓存前缀；导入仍由这条声明式 action 在 Attempt 内完成。
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

/** guest Docker、Node/pnpm 与候选 workspace 的既有 fail-fast 契约，保留为紧随准备流程的 action。 */
function assertRuntime(candidateVersion?: string) {
  return shell({
    id: RUNTIME_CONTRACT_ACTION_ID,
    command: runtimeContractScript(candidateVersion),
    changeFrequency: changeFrequency.rare + (candidateVersion === undefined ? 1 : 2),
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
  return incusAttemptSandbox(
    digestPinnedImage("NICEEVAL_INCUS_INSTALL_IMAGE", "niceeval-eval-install"),
  )
    .before(assertRuntime())
    .before(provisionTargetAppCommand);
}

/** Harness 保留候选安装、两枚离线 runtime、workspace/home 准备与 runtime contract。 */
export function harnessSandbox(candidateVersion: string) {
  loadRepoEnv();
  return incusAttemptSandbox(
    digestPinnedImage("NICEEVAL_INCUS_HARNESS_IMAGE", "niceeval-eval-harness"),
  )
    .before(importHarnessRuntimes())
    .before(installCandidateAndPrepareWorkspace(candidateVersion))
    .before(assertRuntime(candidateVersion));
}
