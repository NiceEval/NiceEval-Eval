FROM docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c AS docker

FROM niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96 AS base

USER root

# corepack 默认把下载缓存放进当前用户的 HOME；镜像由 root 构建、attempt 由 node 执行，
# 两边若各用一份缓存，node 首次运行 pnpm 仍会联网。固定到镜像内的只读共享目录。
ENV COREPACK_HOME=/opt/niceeval-corepack

COPY --from=docker /usr/local/bin/ /usr/local/bin/
COPY --from=docker /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    iproute2 \
    iptables \
    python3 \
    python3-pip \
    python3-venv \
    sqlite3 \
    uidmap \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@11.12.0 --activate \
  && chmod -R a+rX "$COREPACK_HOME" \
  && python3 -m pip install --break-system-packages --no-cache-dir uv \
  && groupadd --system docker \
  && usermod --append --groups docker node \
  && cp -a /home/node /opt/niceeval-node-home

COPY sandbox/niceeval-harness-build.sh /usr/local/bin/niceeval-harness-build
COPY sandbox/niceeval-harness-prepare.sh /usr/local/bin/niceeval-harness-prepare
COPY sandbox/niceeval-runtime-import.sh /usr/local/bin/niceeval-runtime-import

RUN chmod 0755 /usr/local/bin/niceeval-harness-build /usr/local/bin/niceeval-harness-prepare \
  /usr/local/bin/niceeval-runtime-import

# NiceEval 的 DinD provider 会覆盖 Entrypoint/Cmd 为自己的 TTL/log supervisor，并通过默认
# /var/run/docker.sock 暴露同容器 daemon；不要设置 DOCKER_HOST/DOCKER_CONTEXT，避免
# 把 Agent 的裸 docker 命令导向另一套 endpoint。受管命令仍由 factory 的 user: "node"
# 单独控制。

# -------------------------------------------------------------------------------------
# 离线 inner runtime 的两枚固定 digest 物化源。内层被测项目（terminal-bench/regex-log）
# 需要 inner dockerd 本地就有 node / python 两个 tag；两枚 rootfs 归档只在候选镜像物化，
# 由 entrypoint 做本地 docker import。这里**不**经过 base 的 apt 层：物化零安装，
# rootfs 内容完全由固定 digest 镜像决定，不存在随时间漂移的 unpinned 包安装。
#
# 物化方式：对 stage 完整 rootfs 打确定性 tar/gzip（条目排序、固定 mtime、numeric owner、gzip -n），
# 不做手工 ldd 极简化；正确性由 stage 内 RUN 的真实验证命令保证。
# -------------------------------------------------------------------------------------

# node 变体：Debian 12 bookworm + Node v24 + git，无 python3。
FROM niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96 AS runtime-node
USER root
RUN set -eu \
  && node -v \
  && git --version \
  && [ ! -x "$(command -v python3 || true)" ] \
  && mkdir -p /out \
  && tar -C / --sort=name --mtime=@0 --numeric-owner --one-file-system \
       --exclude=./out --exclude=./proc --exclude=./sys --exclude=./dev \
       --exclude=./etc/hostname --exclude=./etc/hosts --exclude=./etc/resolv.conf \
       -cf - . | gzip -n > /out/runtime-node.tar.gz \
  && gzip -t /out/runtime-node.tar.gz \
  && tar -tzf /out/runtime-node.tar.gz >/dev/null \
  && (cd /out && sha256sum runtime-node.tar.gz > runtime-node.tar.gz.sha256)

# python 变体：固定 digest 的 python bookworm，从 runtime-node 补 node 所需文件
# （node 二进制与 nodejs 链接，bookworm 同代 glibc，已实测可运行）。
FROM python:3.11.9-bookworm@sha256:c95170ff7d59de63e9445d3d503644a635c1b8cb7f4fa99f19a1c76da92a849a AS runtime-python
COPY --from=runtime-node /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime-node /usr/local/bin/nodejs /usr/local/bin/nodejs
RUN set -eu \
  && node -v \
  && git --version \
  && python3 --version \
  && mkdir -p /out \
  && tar -C / --sort=name --mtime=@0 --numeric-owner --one-file-system \
       --exclude=./out --exclude=./proc --exclude=./sys --exclude=./dev \
       --exclude=./etc/hostname --exclude=./etc/hosts --exclude=./etc/resolv.conf \
       -cf - . | gzip -n > /out/runtime-python.tar.gz \
  && gzip -t /out/runtime-python.tar.gz \
  && tar -tzf /out/runtime-python.tar.gz >/dev/null \
  && (cd /out && sha256sum runtime-python.tar.gz > runtime-python.tar.gz.sha256)

# -------------------------------------------------------------------------------------
# 以上是所有实验复用的 runtime base；以下候选层只在 build arg 非空时物化 Harness 基建。
FROM base AS candidate

# 候选 niceeval 版本由 harness experiment 经 buildArgs 传入；build key 包含它，因此
# 0.9.0 / 0.12.0 / 每个解析后的 canary 都形成独立可缓存镜像。install 实验以 candidate
# 为 target 且不传版本，保持「安装流程由被测 agent 完成」的测点；ARG 放到通用基线之后，
# 版本变化可复用前层缓存。
ARG NICEEVAL_VERSION=""

# 这里只预装共享基建，不把任何 case repo 烘进镜像。各 eval 在 send 前上传自己的小 repo；
# fixture 迭代不会让候选依赖层失效，也不会产生运行时安装。
COPY sandbox/harness-project/ /opt/niceeval-harness-seed/
RUN if [ -n "$NICEEVAL_VERSION" ]; then /usr/local/bin/niceeval-harness-build; else rm -rf /opt/niceeval-harness-seed; fi

# Harness 才选择这个专用 target；普通 install 直接停在 candidate，因而不依赖、不构建、
# 也不携带两枚大 runtime 归档。
FROM candidate AS harness-candidate
ARG NICEEVAL_VERSION
RUN test -n "$NICEEVAL_VERSION"

COPY --from=runtime-node /out/runtime-node.tar.gz /out/runtime-node.tar.gz.sha256 /opt/niceeval-harness/runtime/
COPY --from=runtime-python /out/runtime-python.tar.gz /out/runtime-python.tar.gz.sha256 /opt/niceeval-harness/runtime/

# 运行期由 entrypoint 先 sha256sum -c，再本地 import 与 --pull=never smoke。
# Agent 遵循随包指引用 pnpm exec 调用 workspace 中的精确候选版本。
RUN chmod 0700 /opt/niceeval-harness/runtime \
  && chmod 0400 /opt/niceeval-harness/runtime/*
