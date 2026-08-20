---
title: 'Linked checkout silently runs stale dist after source update'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

通过 `link:` 消费 NiceEval 工作树时，CLI 不应静默运行与当前源码不一致的旧 `dist`；至少应在启动时拒绝陈旧构建并给出可执行修复，`view` 也不应在构建完成后继续永久托管旧模块图。

## Current Behavior

NiceEval-Eval 把 `niceeval` 链回刚更新的 `NiceEval/main` 后，旧 `dist` 仍可正常启动 `niceeval view`。本次 view 进程于 19:15:22 启动，新的 `dist/report/host/static.cjs` 到 19:15:49 才生成；原进程随后持续返回旧 Overview（根路径 200、无实验选择器），没有 stale-build 提示，也不会因 dist 更新而重载。使用相同 checkout 新启进程后，根路径正确 308 到 `/group/named/harness`，页面包含 harness/install 选择器。

## Possible Solution

构建时写入覆盖完整运行时输入的 build identity；CLI 从本地 symlink/workspace checkout 启动时校验该 identity，陈旧或构建中的 dist 直接以具名错误失败。对长驻 `view`，将 runtime identity 纳入 watcher：identity 变化时明确要求/执行进程级重启，不能只重建已缓存模块图。真实下游验收优先安装一次性 pack candidate，避免可变 link 作为发布候选。

## Minimal Reproducible Example

1. 下游以 `niceeval: link:/path/to/NiceEval` 消费工作树，并保留一次旧 `pnpm build:report` 的 dist。
2. 更新 NiceEval 源码，使内建 report 的公开输出变化。
3. 在新的 `pnpm build:report` 完成前启动 `pnpm exec niceeval view --host 127.0.0.1`。
4. 构建完成后刷新页面；进程继续提供旧页面且无诊断。
5. 终止并重新启动 view；新页面才出现。

## Context

2026-08-20 在 NiceEval-Eval 真实 dogfood 复现。当前 main 的 `show --json` 正确给出 harness/install 两个实验组；旧 view 返回根 Overview 且无 `<select>`，新 view 则重定向到组页并输出实验选择器。
