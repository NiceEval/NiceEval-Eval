# NiceEval Incus base builder

这里从固定 Ubuntu Noble cloud VM 构建 NiceEval-Eval 的通用 bootstrap base。它只负责
创建 Sandbox 之前必须存在的宿主契约：`node` 用户、Node/pnpm、Docker/Compose、DHCP，
以及把 NiceEval 动态附加的 block volume 挂到 `/var/lib/docker` 的 guest-init。

DB-GPT、GPT Researcher、Harness seed、候选 NiceEval 和 inner runtime 都不进入这个镜像；
它们继续由 Experiment 的声明式 `.before(...)` actions 构建并缓存。

## 固定输入

- Ubuntu Noble cloud VM：
  `images:9043ed045f61f207dbd7fc6525671f87b627216bd6707cfe6bebe998a79cda2c`
- Ubuntu packages snapshot：`20260826T000000Z`
- Node.js：`v24.19.0`，下载归档 SHA256 已写在 `provision.sh`
- pnpm：`11.12.0`
- guest-init contract：`block-docker-data/v1`

固定输入使构建过程可复验；Incus publish 的最终 fingerprint 仍以实际输出为准，不能在构建前
猜测。镜像不会自动进入 provider 信任清单。

## 前置条件

先部署 NiceEval Incus development domain。builder 使用它已经声明的固定拓扑：

- project：`niceeval-eval-dev`
- storage pool：`niceeval-sandbox-dev`
- bridge：由 project 的 `default` profile 提供
- remote：`images` 指向 `https://images.linuxcontainers.org`

构建需要可用的 Incus UNIX socket、外网和一个空闲 VM 配额。脚本只清理自己创建的具名临时
VM/volume，不覆盖已有 alias，也不修改 `it-infra` 或项目源码中的受信 digest。

## 新部署

目标 alias 不存在时直接运行：

```sh
cd sandbox/incus-base
./build.sh
```

脚本依次：启动固定 Ubuntu VM、执行 `provision.sh`、停机发布、附加一个真实 4 GiB block
volume 启动验证、重启验证持久性，最后打印：

```text
niceeval-eval-base@sha256:<64 lowercase hex>
```

## 重建现有部署

不要覆盖正在被 provider 信任的 alias。先构建候选：

```sh
./build.sh niceeval-eval-base-candidate
```

人工复核输出 fingerprint 后，再作为一次协调变更完成：

1. 把 `it-infra` 的 `trustedBaseImages` 更新为新的精确 locator。
2. 把本仓库 `lib/experiment-runtime.ts` 的 `INCUS_BASE_IMAGE` 更新为同一 locator。
3. 将 `niceeval-eval-base` alias 从旧 fingerprint 切到新 fingerprint。
4. 运行 `niceeval sandbox provider doctor incus --development`。
5. 用一格 `niceeval exp ... --dry --json` 检查携带状态；真实重跑仍需单独批准。

候选 image 本身是私有 Incus artifact，不提交二进制；本目录提交的是从公开固定输入重建它的
完整过程和真实启动验证。
