#!/bin/sh
# 以 root 执行，结果随 rootfs 前缀缓存。只用于文档消融族：候选装好之后删掉随包文档
#（INDEX.md、docs-site、docs-source）和 niceeval init 写进 AGENTS.md 的指引块。
# 留下的是类型声明、源码与 CLI --help——同一个版本、没有文档时 agent 能靠什么。
set -eu
package="$(readlink -f /opt/niceeval-harness/node_modules/niceeval)"
workspace=/data/home/workspace

test -f "$package/INDEX.md" || { echo "候选包里没有 INDEX.md，文档消融没有对照意义" >&2; exit 1; }
rm -rf "$package/INDEX.md" "$package/docs-site" "$package/docs-source"

rules="$workspace/AGENTS.md"
grep -q 'BEGIN:niceeval-agent-rules' "$rules" || { echo "$rules 里没有 niceeval init 的指引块" >&2; exit 1; }
sed -i '/BEGIN:niceeval-agent-rules/,/END:niceeval-agent-rules/d' "$rules"
if grep -q 'INDEX.md' "$rules"; then echo "$rules 仍然指向随包文档" >&2; exit 1; fi

printf '随包文档已移除：%s\n' "$package"
