#!/bin/sh
# 把候选镜像构建期物化的离线 inner runtime 归档导入 inner dockerd：
#
#   runtime-node.tar.gz   → offline.invalid/niceeval-harness/runtime:node
#   runtime-python.tar.gz → offline.invalid/niceeval-harness/runtime:python
#
# 由 niceeval-dind-entrypoint 在 inner dockerd 就绪后调用；全程只碰本地 socket 与本地
# 文件，不联网。失败即非零退出，整个 Sandbox 直接 errored，不把一台缺运行时的环境交给
# 被测 agent。
set -eu

socket=${NICEEVAL_DOCKER_SOCKET:-/run/niceeval-docker/docker.sock}
runtime_dir=/opt/niceeval-harness/runtime

if [ ! -d "$runtime_dir" ]; then
  echo "没有离线 runtime 归档目录（$runtime_dir），跳过导入" >&2
  exit 0
fi

cd "$runtime_dir"

# 1. 先校验归档与构建期 sha256 匹配，再导入；校验失败即退出。
sha256sum -c runtime-node.tar.gz.sha256
sha256sum -c runtime-python.tar.gz.sha256

# 2. 本地 docker import（tar 来自本机镜像层，不碰网络）。
for variant in node python; do
  archive="runtime-$variant.tar.gz"
  tag="offline.invalid/niceeval-harness/runtime:$variant"
  echo "导入 inner runtime:$variant（$archive）…"
  docker --host="unix://$socket" import "$archive" "$tag"
done

# 3. 用 --pull=never 的真实 docker run 冒烟：node 变体 node/git 可用且 python3 不可执行；
#    python 变体 node/git/python3 全可用。任何一步失败都直接退出。
node_ok() {
  docker --host="unix://$socket" run --pull=never --rm --entrypoint /bin/sh \
    offline.invalid/niceeval-harness/runtime:node -c 'node -v && git --version && ! command -v python3'
}
python_ok() {
  docker --host="unix://$socket" run --pull=never --rm --entrypoint /bin/sh \
    offline.invalid/niceeval-harness/runtime:python -c 'node -v && git --version && python3 --version'
}

node_ok || { echo "inner runtime:node 冒烟失败（node/git 或 python3 排除项）" >&2; exit 1; }
python_ok || { echo "inner runtime:python 冒烟失败（node/git/python3）" >&2; exit 1; }

echo "inner runtime 就绪：offline.invalid/niceeval-harness/runtime:{node,python}"
