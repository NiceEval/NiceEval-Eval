FROM docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c AS docker

FROM niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96

USER root

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
  && corepack enable \
  && corepack prepare pnpm@10.15.1 --activate \
  && python3 -m pip install --break-system-packages --no-cache-dir uv \
  && groupadd --system docker \
  && usermod --append --groups docker node \
  && cp -a /home/node /opt/niceeval-node-home

COPY niceeval-dind-entrypoint.sh /usr/local/bin/niceeval-dind-entrypoint

RUN chmod 0755 /usr/local/bin/niceeval-dind-entrypoint

ENV DOCKER_HOST=unix:///run/niceeval-docker/docker.sock

# NiceEval 会覆盖 Cmd 为自己的 TTL/log supervisor；ENTRYPOINT 先把同容器 dockerd 启好，
# 再 exec 回 NiceEval 的 Cmd。受管命令由 factory 的 user: "node" 单独控制。
ENTRYPOINT ["/usr/local/bin/niceeval-dind-entrypoint"]
