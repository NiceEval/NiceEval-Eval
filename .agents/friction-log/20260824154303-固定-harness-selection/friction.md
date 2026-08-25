---
title: '固定 Harness selection 仍在顶层解析 canary dist-tag'
severity: 'minor'
---

## Expected Behavior

只选择固定 `harness/v0.12.0` 时，不需要解析未选择的 canary；canary dist-tag 只在该 experiment 真正需要时解析。

## Current Behavior

在隔离 driver 中只选择固定实验 `harness/v0.12.0`，NiceEval-Eval 仍会在载入配置时查询 npm 的 canary dist-tag。driver 使用 `--network none` 时，在进入 selection/debug 前失败；开放网络后相同固定实验可正常执行。

## Possible Solution

把 canary dist-tag 解析移到该 experiment 的惰性发现或执行边界，避免成为所有固定 experiment 的顶层启动依赖。

## Minimal Reproducible Example

1. 将当前 NiceEval candidate link 到 NiceEval-Eval。
2. 在无网络容器中运行 `niceeval debug harness/v0.12.0 harness/terminal-bench/regex-log`。
3. 观察配置载入阶段尝试解析 canary dist-tag 并因网络不可用失败。
4. 给同一容器开放网络，重新运行完全相同的固定 selection。

## Context

本轮 DinD setup-prefix dogfood 的固定 `harness/v0.12.0` driver 在 `--network none` 下稳定失败；移除该网络限制后，debug、冷启动和五轮热启动均进入同一个既有 experiment/eval。
