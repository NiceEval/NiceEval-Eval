#!/bin/sh
set -eu

# minimal 有 git/curl/Python；显式声明工具依赖，避免依赖模板的隐式预装。
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git xz-utils unzip build-essential \
  python3 python3-pip python3-venv python-is-python3 docker.io docker-cli docker-compose
rm -rf /var/lib/apt/lists/*

# root 盘只有 8 GiB；inner Docker 的镜像与构建缓存放进可快照的 /data 盘。
systemctl stop docker.service docker.socket
install -d /etc/docker /data/docker
printf '%s\n' '{"data-root":"/data/docker"}' > /etc/docker/daemon.json
sandbox_user=$(getent passwd 1000 | cut -d: -f1)
test -n "$sandbox_user"
usermod -aG docker "$sandbox_user"
systemctl enable --now docker
docker info --format '{{.DockerRootDir}}'
docker compose version

# 固定 uv 版本与现有 Terminal-Bench fixture 一致；宿主 Python 项目可自行选择 Python 版本。
curl -fsSL https://astral.sh/uv/0.7.13/install.sh -o /tmp/install-uv.sh
UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh /tmp/install-uv.sh
rm /tmp/install-uv.sh
uv --version
python -m venv /tmp/minimal-venv-check
rm -rf /tmp/minimal-venv-check
