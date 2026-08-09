#!/bin/sh
# NiceEval 的 DinD provider 已完成 daemon readiness 后，物化 Harness attempt 的可写状态。
# 这不是镜像 ENTRYPOINT：provider 接管容器启动，Experiment 通过显式 setup hook 调用本脚本。
set -eu

# /home/node 是有界 tmpfs；把镜像里的只读初始 home 恢复进去，再交回 node。
cp -a /opt/niceeval-node-home/. /home/node/
chown -R node:node /home/node

# 候选镜像才有这棵 root-only 项目基建。复制 package/lock/候选版 AGENTS 等；
# node_modules 是指向镜像只读依赖树的 symlink。case repo 随后由 eval 上传，不安装、不联网。
fixture_project=/opt/niceeval-harness/project
workspace=/home/sandbox/workspace
test -d "$fixture_project"
mkdir -p "$workspace"
cp -a "$fixture_project/." "$workspace/"
chown -R node:node "$workspace"

# 两枚离线 inner runtime 归档由候选镜像提供；导入 provider 的 canonical 默认 socket。
NICEEVAL_DOCKER_SOCKET=/var/run/docker.sock /usr/local/bin/niceeval-runtime-import
