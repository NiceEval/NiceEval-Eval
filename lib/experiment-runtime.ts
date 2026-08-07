/**
 * 各实验共用的 Docker-in-Docker sandbox 装配。
 *
 * 单个评估容器同时承载 coding agent 和内层 dockerd；agent 以 node 身份执行，但能通过
 * 同容器 Unix socket 使用 docker / docker compose。privileged 只允许落到显式 rootless
 * 外层 daemon，NiceEval 在 create 前 fail-closed 验证。
 */

import { dockerSandbox } from "niceeval/sandbox";
import type { SandboxHook } from "niceeval/sandbox";
import { provisionTargetAppEnv } from "./target-app-env.ts";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

function assertRuntime(): SandboxHook {
  return async (sandbox, ctx) => {
    const [node, user, docker, compose] = await Promise.all([
      sandbox.runCommand("node", ["-v"]),
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
    if (docker.exitCode !== 0 || docker.stdout.trim() === "") {
      throw new Error(`同容器 inner dockerd 不可用：${docker.stderr.trim() || "docker info 无输出"}`);
    }
    if (compose.exitCode !== 0 || compose.stdout.trim() === "") {
      throw new Error(`docker compose 不可用：${compose.stderr.trim() || "compose version 无输出"}`);
    }
    ctx.progress({
      message: `DinD 基线通过：Node ${node.stdout.trim()} · Docker ${docker.stdout.trim()} · Compose ${compose.stdout.trim()}`,
    });
  };
}

/**
 * rootfs 只读；所有需要写入的位置都落到有大小上限的 tmpfs。memoryBytes 同时禁止额外 swap，
 * 因而单 attempt 无法靠 writable layer 或 inner image 把共享外层 data-root 写满。
 * 带 tmpfs 的 provider 能力是 DestroyOnly，NiceEval 会拒绝 --keep-sandbox。
 */
export function sandboxWith(profile: "node" | "python" = "node") {
  const base = dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../sandbox/", import.meta.url),
    },
    profile: "default",
    user: "node",
    privileged: "rootless",
    readiness: {
      command: ["docker", "info"],
      user: "node",
      timeoutMs: 30_000,
      intervalMs: 250,
    },
    resources: {
      cpus: 4,
      memoryBytes: 6 * GIB,
      pidsLimit: 2048,
      readOnlyRootfs: true,
      tmpfs: {
        "/var/lib/docker": { sizeBytes: 3 * GIB, mode: 0o711, uid: 0, gid: 0, executable: true },
        "/home/sandbox/workspace": {
          sizeBytes: 2 * GIB,
          mode: 0o755,
          uid: 1000,
          gid: 1000,
          executable: true,
        },
        "/home/node": { sizeBytes: 512 * MIB, mode: 0o700, uid: 1000, gid: 1000, executable: true },
        "/tmp": { sizeBytes: 1024 * MIB, mode: 0o1777, uid: 0, gid: 0 },
        "/run": { sizeBytes: 128 * MIB, mode: 0o755, uid: 0, gid: 0 },
        "/root": { sizeBytes: 64 * MIB, mode: 0o700, uid: 0, gid: 0 },
        "/opt/fixture-secrets": { sizeBytes: 16 * MIB, mode: 0o700, uid: 1000, gid: 1000 },
      },
    },
  }).setup(assertRuntime());
  return profile === "python" ? base.setup(provisionTargetAppEnv()) : base;
}
