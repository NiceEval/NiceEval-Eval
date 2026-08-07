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

COPY sandbox/niceeval-dind-entrypoint.sh /usr/local/bin/niceeval-dind-entrypoint
COPY sandbox/niceeval-harness-build.sh /usr/local/bin/niceeval-harness-build

RUN chmod 0755 /usr/local/bin/niceeval-dind-entrypoint /usr/local/bin/niceeval-harness-build

ENV DOCKER_HOST=unix:///run/niceeval-docker/docker.sock

# NiceEval 会覆盖 Cmd 为自己的 TTL/log supervisor；ENTRYPOINT 先把同容器 dockerd 启好，
# 再 exec 回 NiceEval 的 Cmd。受管命令由 factory 的 user: "node" 单独控制。
ENTRYPOINT ["/usr/local/bin/niceeval-dind-entrypoint"]

# 以上是所有实验复用的 runtime base；以下候选层只在 build arg 非空时物化 Harness 基建。
FROM base AS candidate

# 候选 niceeval 版本由 harness experiment 经 buildArgs 传入；build key 包含它，因此
# 0.9.0 / 0.12.0 / 每个解析后的 canary 都形成独立可缓存镜像。install 实验不传，
# 保持「安装流程由被测 agent 完成」的测点。ARG 放到通用基线之后，版本变化可复用前层缓存。
ARG NICEEVAL_VERSION=""

# 这里只预装共享基建，不把任何 case repo 烘进镜像。各 eval 在 send 前上传自己的小 repo；
# fixture 迭代不会让候选依赖层失效，也不会产生运行时安装。
COPY sandbox/harness-project/ /opt/niceeval-harness-seed/
RUN if [ -n "$NICEEVAL_VERSION" ]; then /usr/local/bin/niceeval-harness-build; else rm -rf /opt/niceeval-harness-seed; fi
