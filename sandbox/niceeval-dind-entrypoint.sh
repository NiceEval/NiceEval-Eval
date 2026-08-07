#!/bin/sh
set -eu

socket=/run/niceeval-docker/docker.sock
pidfile=/run/niceeval-docker/docker.pid
log=/tmp/niceeval-inner-dockerd.log

# /home/node 是有界 tmpfs；把镜像里的只读初始 home 恢复进去，再交回 node。
cp -a /opt/niceeval-node-home/. /home/node/
chown -R node:node /home/node

# 候选镜像才有这棵 root-only 项目基建。容器启动时复制 package/lock/候选版 AGENTS 等；
# node_modules 是指向镜像只读依赖树的 symlink。case repo 随后由 eval 上传，不发生安装或联网。
fixture_project=/opt/niceeval-harness/project
workspace=/home/sandbox/workspace
if [ -d "$fixture_project" ]; then
  mkdir -p "$workspace"
  cp -a "$fixture_project/." "$workspace/"
  chown -R node:node "$workspace"
fi

rm -f "$socket" "$pidfile"
dockerd \
  --host="unix://$socket" \
  --data-root=/var/lib/docker \
  --exec-root=/run/niceeval-docker/exec \
  --pidfile="$pidfile" \
  --storage-driver=vfs \
  --tls=false \
  >"$log" 2>&1 &
dockerd_pid=$!

ready=0
attempt=0
while [ "$attempt" -lt 120 ]; do
  if ! kill -0 "$dockerd_pid" 2>/dev/null; then
    echo "inner dockerd exited before becoming ready" >&2
    tail -n 200 "$log" >&2 || true
    exit 1
  fi
  if docker --host="unix://$socket" info >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done

if [ "$ready" -ne 1 ]; then
  echo "inner dockerd did not become ready within 30 seconds" >&2
  tail -n 200 "$log" >&2 || true
  exit 1
fi

chgrp docker /run/niceeval-docker "$socket"
chmod 0750 /run/niceeval-docker
chmod 0660 "$socket"

exec "$@"
