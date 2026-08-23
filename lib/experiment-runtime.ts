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
import { dockerSandbox } from "niceeval/sandbox";
import type { SandboxHook } from "niceeval/sandbox";
import { provisionTargetAppEnv } from "./target-app-env.ts";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/**
 * 安装题只根据对话、工具调用和最终工作区判分，不消费 Codex 的 OTLP trace。Docker 的只读
 * rootfs 会让 collector 通过 shell/base64 搬运 trace；长会话能产生上百 MiB，反而挤占 attempt
 * deadline。保留官方 adapter 的安装、setup、send 和证据采集，只关闭这条非判分遥测通道。
 */
export function installCodexAgent() {
  return { ...codexAgent(), tracing: undefined };
}

/**
 * DinD 基线与镜像预装就绪检查（原 `readiness` 的语义，改成 setup hook）。
 * candidateVersion 传入时，root entrypoint 已把镜像内项目基建物化进 workspace；这里核对
 * package、依赖 symlink、候选版 AGENTS 与精确候选版本，并确认尚未混入任何 case 源码。
 */
function assertRuntime(candidateVersion?: string): SandboxHook {
  return async (sandbox, ctx) => {
    const [node, pnpm, user, docker, compose] = await Promise.all([
      sandbox.runCommand("node", ["-v"]),
      sandbox.runCommand("pnpm", ["--version"]),
      sandbox.runCommand("id", ["-u"]),
      sandbox.runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]),
      sandbox.runCommand("docker", ["compose", "version", "--short"]),
    ]);
    const major = /^v(\d+)\./.exec(node.stdout.trim())?.[1];
    if (node.exitCode !== 0 || major !== "24") {
      throw new Error(`sandbox Node 必须是 v24.x，实测 ${node.stdout.trim() || node.stderr.trim() || "无输出"}`);
    }
    if (user.exitCode !== 0 || user.stdout.trim() !== "1000") {
      throw new Error(`受管命令必须以 node(uid 1000) 执行，实测 ${user.stdout.trim() || user.stderr.trim()}`);
    }
    if (pnpm.exitCode !== 0 || pnpm.stdout.trim() !== "11.12.0") {
      throw new Error(`sandbox pnpm 必须是 11.12.0，实测 ${pnpm.stdout.trim() || pnpm.stderr.trim() || "无输出"}`);
    }
    if (docker.exitCode !== 0 || docker.stdout.trim() === "") {
      throw new Error(`同容器 inner dockerd 不可用：${docker.stderr.trim() || "docker info 无输出"}`);
    }
    if (compose.exitCode !== 0 || compose.stdout.trim() === "") {
      throw new Error(`docker compose 不可用：${compose.stderr.trim() || "compose version 无输出"}`);
    }
    if (candidateVersion !== undefined) {
      const [project, modules, installed, projectCli, guidance, noCaseSource] = await Promise.all([
        sandbox.runCommand("test", ["-f", "package.json"]),
        sandbox.runCommand("test", ["-L", "node_modules"]),
        sandbox.runCommand("node", ["-p", "require('./node_modules/niceeval/package.json').version"]),
        sandbox.runCommand("pnpm", ["exec", "niceeval", "--version"]),
        sandbox.runCommand("test", ["-f", "AGENTS.md"]),
        sandbox.runCommand("test", ["!", "-e", "src"]),
      ]);
      if (project.exitCode !== 0 || modules.exitCode !== 0 || guidance.exitCode !== 0) {
        throw new Error(
          `workspace 缺预装项目基建、候选版 AGENTS 或 node_modules symlink：niceeval@${candidateVersion} ` +
            `镜像没有完成 build/entrypoint 物化。`,
        );
      }
      if (installed.exitCode !== 0 || installed.stdout.trim() !== candidateVersion) {
        throw new Error(
          `workspace 候选版本不符：期望 niceeval@${candidateVersion}，实测 ` +
            `${installed.stdout.trim() || installed.stderr.trim() || "无输出"}`,
        );
      }
      if (projectCli.exitCode !== 0 || projectCli.stdout.trim() !== candidateVersion) {
        throw new Error(
          `workspace 项目内 niceeval 命令不可用或版本不符：期望 ${candidateVersion}，实测 ` +
            `${projectCli.stdout.trim() || projectCli.stderr.trim() || "无输出"}`,
        );
      }
      if (noCaseSource.exitCode !== 0) {
        throw new Error(`候选镜像错误地烘入了 case 源码（niceeval@${candidateVersion}）`);
      }
    }
    ctx.progress({
      message:
        `运行基线通过：Node ${node.stdout.trim()} · pnpm ${pnpm.stdout.trim()} · ` +
        `Docker ${docker.stdout.trim()} · Compose ${compose.stdout.trim()}`,
    });
  };
}

/**
 * 当前 NiceEval DinD provider 接管容器启动命令；候选镜像不能再依赖自身 ENTRYPOINT 做
 * attempt 级初始化。这里在 daemon readiness 之后恢复用户 home、物化预装项目，并把两枚
 * 固定 runtime 归档导入 provider 暴露的默认 Unix socket。
 */
function prepareHarnessCandidate(candidateVersion?: string): SandboxHook {
  return async (sandbox, ctx) => {
    if (candidateVersion === undefined) return;
    ctx.progress({ message: `物化 Harness 候选运行时：niceeval@${candidateVersion}` });
    const prepared = await sandbox.runCommand("niceeval-harness-prepare", [], { user: "root", stream: true });
    if (prepared.exitCode !== 0) {
      throw new Error(
        `Harness 候选运行时物化失败（niceeval@${candidateVersion}）：` +
          `${prepared.stderr.trim() || prepared.stdout.trim() || `exit ${prepared.exitCode}`}`,
      );
    }
  };
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
  }).setup(prepareHarnessCandidate(candidateVersion)).setup(assertRuntime(candidateVersion));
  return profile === "python" ? base.setup(provisionTargetAppEnv()) : base;
}
