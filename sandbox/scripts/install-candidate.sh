#!/bin/sh
# 以 root 执行，结果随 rootfs 前缀缓存。在项目 seed 上安装候选 NiceEval、运行 niceeval init，
# 清掉 init 生成的示例源码，再把只读依赖树与 workspace 物化出来。题目源码由各 Eval 的 fixture 上传。
# 调用方在前面定义：candidate_version。
set -eu
seed=/data/home/niceeval-harness-seed
scratch=/opt/niceeval-harness
project="$scratch/project"
modules="$scratch/node_modules"
store="$scratch/pnpm-store"
workspace=/data/home/workspace

test -d "$seed"
rm -rf "$scratch"
mkdir -p "$project" "$store"
cp -a "$seed/." "$project/"

# pnpm 11 的 minimumReleaseAge 默认策略会拦截刚发布的候选；被测对象不受包年龄限制。
export npm_config_minimum_release_age=0
printf '安装 harness 候选 niceeval@%s…\n' "$candidate_version"
(cd "$project" && pnpm add -D --allow-build=autoevals --store-dir "$store" "niceeval@$candidate_version" && pnpm exec niceeval init)

# init 只提供候选版本的项目指引；题目源码、agent、eval 与 experiment 由 case fixture 上传。
rm -rf "$project/agents" "$project/config" "$project/docs" "$project/evals" \
  "$project/experiments" "$project/src"
mkdir -p "$project/evals" "$project/experiments"

# 保留绝对 symlink 和 root 拥有的只读依赖树；清空仅供安装使用的 pnpm store 后，后续命令
# 继续使用已物化的候选依赖。Sandbox 仍保留公网访问，题内项目可按上游方式安装依赖。
mv "$project/node_modules" "$modules"
ln -s "$modules" "$project/node_modules"
rm -rf "$store"
mkdir -p "$store/v11"
chmod -R a+rX "$modules" "$store"
chmod 0700 "$project"

mkdir -p "$workspace"
cp -a "$project/." "$workspace/"
box_user="$(id -un 1000 2>/dev/null || id -un)"
box_group="$(id -gn "$box_user" 2>/dev/null || id -gn)"
chown -R "$box_user:$box_group" "$workspace"

printf 'harness 候选就绪：niceeval@%s\n' "$candidate_version"
