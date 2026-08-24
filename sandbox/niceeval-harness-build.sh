#!/bin/sh
# 在 Docker build 阶段把「候选 niceeval + pnpm + niceeval init」一次性物化成共享项目基建。
# 三个 case 的小 repo 不进镜像，由各自 Eval 的 fixture action 写入；见 fixtures/harness/README.md。
#
# 运行条件：NICEEVAL_VERSION 非空（Dockerfile 只在 ARG 有值时调用本脚本）。
# 产物分两层：root-only 的项目基建由 Experiment action 复制进 workspace；node_modules 单独留在
# node 可读的只读目录，project 只保留绝对 symlink。每个 attempt 只再覆盖一份几 KB 的 repo。
set -eu

src=/opt/niceeval-harness-seed
harness_root=/opt/niceeval-harness
project="$harness_root/project"
modules="$harness_root/node_modules"
store="$harness_root/pnpm-store"
version="$NICEEVAL_VERSION"

if [ -z "$version" ]; then
  echo "NICEEVAL_VERSION 为空，跳过 harness 基建预装（install 实验不需要）" >&2
  exit 0
fi

# pnpm 11 的 minimumReleaseAge 默认策略会拦下发布不足 30 天的候选版本（0.9.x、canary
# 都是近发布的包），被评对象本身不应受版本年龄影响。环境变量让 add 全链路一致生效。
export npm_config_minimum_release_age=0

echo "预装 harness 共享基建（niceeval@$version）…"
rm -rf "$harness_root"
mkdir -p "$project" "$store"
cp -a "$src/." "$project/"
(cd "$project" && pnpm add -D --store-dir "$store" "niceeval@$version" && pnpm exec niceeval init)

# init 只负责生成与候选版本匹配的项目指引。题目源码、agent、eval 与 experiment 全由
# case repo 提供；清掉 init 可能生成的示例，避免它们混入任一道题的发现结果。
rm -rf "$project/agents" "$project/config" "$project/docs" "$project/evals" \
  "$project/experiments" "$project/src"
mkdir -p "$project/evals" "$project/experiments"

# pnpm 的链接树已经完整物化；把它移到公开只读区，workspace 里只复制一个 symlink。
# store 只参与这一层构建，同一 RUN 内清空后不会进入最终镜像；保留空目录是为了让
# node_modules/.modules.yaml 记录的 storeDir 仍指向一个存在的路径。
mv "$project/node_modules" "$modules"
ln -s "$modules" "$project/node_modules"
rm -rf "$store"
mkdir -p "$store/v11"
chmod -R a+rX "$modules" "$store"

# 只有 root 权限的准备 action 读取项目基建；这里没有任何 case 的业务源码或答案。
chmod 0700 "$project"

# seed 只服务 build 阶段，构建完即清。
rm -rf /opt/niceeval-harness-seed

echo "harness 共享基建预装完成：$project（niceeval@$version）"
