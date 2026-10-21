#!/usr/bin/env bash

set -euo pipefail

assets_dir="${1:?需要传入 staged assets 目录}"
node_version="24.19.0"
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_sha256="14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"
scratch_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$scratch_dir"
}
trap cleanup EXIT

for asset in \
  50-niceeval-dhcp.yaml \
  niceeval-docker-data \
  niceeval-docker-data.service \
  ubuntu.sources
do
  test -f "$assets_dir/$asset"
done

echo "固定 Ubuntu package snapshot"
install -m 0644 "$assets_dir/ubuntu.sources" /etc/apt/sources.list.d/ubuntu.sources
rm -f /etc/apt/sources.list
find /etc/apt/sources.list.d -maxdepth 1 -type f ! -name ubuntu.sources -delete

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  docker-compose-v2 \
  docker.io \
  e2fsprogs \
  git \
  netplan.io \
  sudo \
  xz-utils

echo "把 Ubuntu cloud 默认 uid 1000 用户规范成 NiceEval 的 node 用户"
if id node >/dev/null 2>&1; then
  test "$(id -u node)" = 1000
elif id ubuntu >/dev/null 2>&1 && test "$(id -u ubuntu)" = 1000; then
  if getent group ubuntu >/dev/null 2>&1; then
    groupmod --new-name node ubuntu
  fi
  usermod --login node --home /home/node --move-home ubuntu
else
  echo "找不到 uid 1000 的 ubuntu/node 用户" >&2
  exit 1
fi
usermod --append --groups docker node
sed -i 's/^    name: ubuntu$/    name: node/' /etc/cloud/cloud.cfg
if test -f /etc/sudoers.d/90-cloud-init-users; then
  sed -i 's/^ubuntu /node /' /etc/sudoers.d/90-cloud-init-users
fi

echo "安装带校验和的 Node.js v$node_version"
curl --fail --location --show-error --silent \
  "https://nodejs.org/dist/v${node_version}/${node_archive}" \
  --output "$scratch_dir/$node_archive"
printf '%s  %s\n' "$node_sha256" "$scratch_dir/$node_archive" | sha256sum --check --strict
tar -xJf "$scratch_dir/$node_archive" -C /usr/local --strip-components=1
npm install --global "pnpm@11.12.0"

echo "安装 DHCP 与 block Docker data guest-init"
rm -f /etc/netplan/50-cloud-init.yaml /etc/netplan/50-niceeval-static.yaml
install -m 0600 "$assets_dir/50-niceeval-dhcp.yaml" /etc/netplan/50-niceeval-dhcp.yaml
install -m 0755 "$assets_dir/niceeval-docker-data" /usr/local/sbin/niceeval-docker-data
install -m 0644 "$assets_dir/niceeval-docker-data.service" \
  /etc/systemd/system/niceeval-docker-data.service
netplan generate
systemctl daemon-reload
systemctl enable niceeval-docker-data.service docker.service

echo "验证固定 runtime"
test "$(node --version)" = "v$node_version"
test "$(pnpm --version)" = "11.12.0"
test "$(id -u node)" = "1000"
git --version
docker info >/dev/null
docker compose version

echo "清理可变运行状态"
systemctl stop docker.service docker.socket containerd.service
find /var/lib/docker -mindepth 1 -delete
find /var/lib/containerd -mindepth 1 -delete
install -d -m 0755 /usr/share/niceeval-incus-base
{
  printf 'source_image=%s\n' \
    'images:9043ed045f61f207dbd7fc6525671f87b627216bd6707cfe6bebe998a79cda2c'
  printf 'ubuntu_snapshot=%s\n' '20260826T000000Z'
  printf 'node=%s\n' "$(node --version)"
  printf 'pnpm=%s\n' "$(pnpm --version)"
  dpkg-query --show --showformat='${binary:Package}=${Version}\n' \
    docker.io docker-compose-v2 containerd runc
} > /usr/share/niceeval-incus-base/build-manifest.txt

apt-get clean
find /var/lib/apt/lists -mindepth 1 -delete
rm -rf /tmp/niceeval-incus-base
cloud-init clean --logs --machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
sync
