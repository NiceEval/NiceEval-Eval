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
 * context 是仓库根，.dockerignore 把 context 白名单收窄到 sandbox/。候选版本经
 * buildArgs 传入并参与镜像身份（buildKey），每个版本一个可缓存、互不覆盖的共享基建镜像；
 * case repo 不进 build context，由所属 eval 在 send 前上传。
 */

import { codexAgent } from "niceeval/adapter";
import {
  actionRef,
  changeFrequency,
  command,
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
const HARNESS_WORKSPACE_ACTION_ID = "niceeval-eval.prepare-workspace-and-home";
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
  return command("/usr/local/bin/niceeval-runtime-import", [], {
    id: HARNESS_RUNTIME_IMPORT_ACTION_ID,
    user: "root",
    changeFrequency: changeFrequency.rare,
    cache: { state: sandboxState.dockerData },
  });
}

/**
 * 候选 workspace 与 node home 都位于 attempt 私有 tmpfs，必须在 runtime 导入满足后逐次恢复。
 * 省略 cache.state 即保留默认 all，不能并入只捕获 Docker data-root 的前缀。
 */
function prepareHarnessWorkspaceAndHome() {
  return command("niceeval-harness-prepare", [], {
    id: HARNESS_WORKSPACE_ACTION_ID,
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
      ? {}
      : { dependsOn: [actionRef(HARNESS_WORKSPACE_ACTION_ID)] }),
  });
}

function runtimeContractScript(candidateVersion?: string): string {
  const candidateContract = candidateVersion === undefined
    ? ""
    : `
candidate_version=${shellQuote(candidateVersion)}
test -f package.json && test -L node_modules && test -f AGENTS.md || \
  fail "workspace 缺预装项目基建、候选版 AGENTS 或 node_modules symlink：niceeval@$candidate_version 镜像没有完成 build/entrypoint 准备。"
installed_version="$(node -p "require('./node_modules/niceeval/package.json').version" 2>&1)" || \
  fail "workspace 候选版本不可读：niceeval@$candidate_version"
[ "$installed_version" = "$candidate_version" ] || \
  fail "workspace 候选版本不符：期望 niceeval@$candidate_version，实测 $installed_version"
project_cli_version="$(pnpm exec niceeval --version 2>&1)" || \
  fail "workspace 项目内 niceeval 命令不可用：niceeval@$candidate_version"
[ "$project_cli_version" = "$candidate_version" ] || \
  fail "workspace 项目内 niceeval 命令版本不符：期望 $candidate_version，实测 $project_cli_version"
[ ! -e src ] || fail "候选镜像错误地烘入了 case 源码（niceeval@$candidate_version）"`;

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
    revision: "1",
    inputs: { path: TARGET_APP_ENV_PATH, proxyProtocol: "target-app-sidecar/v1" },
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
 * rootfs 只读；工作区等小型可写路径落到有大小上限的 tmpfs。inner `/var/lib/docker`
 * 由宿主 storage profile 授予磁盘 backed、project-quota 限额的私有分配，不再占用 shmem。
 * memoryBytes 同时禁止额外 swap，单 attempt 也无法把共享外层 data-root 写满。
 * 每 Attempt 限 1 CPU / 4 GiB。宿主 checkout 与 Codex session 都落在 tmpfs；原 1536 MiB 上限会在
 * 长安装对话里把 app-server 以 exit 137 杀掉。整批吞吐另由仓库级并发上限约束。
 * 带 tmpfs 的 provider 能力是 DestroyOnly，NiceEval 会拒绝 --keep-sandbox。
 *
 * candidateVersion 可选：harness 实验传版本号触发共享基建预装（buildArgs NICEEVAL_VERSION）；
 * install 实验不传，保持「安装流程由被测 agent 在沙箱内完成」的测点。
 */
export function sandboxWith(profile: "node" | "python" = "node", candidateVersion?: string) {
  const harnessCandidate = candidateVersion !== undefined;
  const base = dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../", import.meta.url),
      file: "sandbox/Dockerfile",
      ...(harnessCandidate
        ? {
            buildArgs: { NICEEVAL_VERSION: candidateVersion },
            target: "harness-candidate",
          }
        : { target: "candidate" }),
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
        "/tmp": { sizeBytes: 2 * GIB, mode: 0o1777, uid: 0, gid: 0 },
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
  const runtime = candidateVersion === undefined
    ? base.before(assertRuntime())
    : base
        .before(importHarnessRuntimes())
        .before(prepareHarnessWorkspaceAndHome())
        .before(assertRuntime(candidateVersion));
  return profile === "python"
    ? runtime.before(provisionTargetAppCommand)
    : runtime;
}
