---
title: 'README 的 show 示例使用 CLI 已拒绝的 --exp 与 --history'
severity: 'minor'
---

## Expected Behavior

README 的结果诊断示例应与当前消费版本的公开 CLI 一致，并能直接运行。

## Current Behavior

README 使用 `pnpm exec niceeval show --exp <experiment-id>` 和 `--history`。当前仓库实际链接的 NiceEval CLI 只接受 `--experiment <selector>`，并拒绝 `--history`，导致按入口文档操作时先得到参数错误。

## Possible Solution

将 README 示例同步为当前 CLI 实际支持的 `--experiment` 形状，并删除或替换尚未支持的 `--history` 示例。

## Minimal Reproducible Example

1. 在 `/home/ctrdh/Code/NiceEval/NiceEval-Eval` 运行 `pnpm --silent exec niceeval show --exp install/canary`，观察 `Unknown option --exp`。
2. 运行 `pnpm --silent exec niceeval show --experiment install/canary`，命令成功显示结果。
3. 运行 `pnpm --silent exec niceeval show --experiment install/canary --history`，观察 `Unknown option --history`。

## Context

本问题在使用公开 CLI 复核评分制 Report 展示时发现。候选双实例的 workspace override 摩擦已有独立条目，本条只记录 README 参数漂移。
