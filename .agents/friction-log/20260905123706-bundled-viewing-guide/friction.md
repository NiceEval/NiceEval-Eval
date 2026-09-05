---
title: 'Bundled viewing guide recommends rejected show --experiment --all'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

## Expected Behavior
随包 viewing-results.mdx 中推荐的 show --experiment <id> --all 应能运行，或文档只推荐受支持命令。

## Current Behavior
当前 INDEX 指向的 tutorials/viewing-results.mdx 建议缩小 experiment 后加 --all 展示全部 Attempt，但 CLI 拒绝：--all applies only to Results, not --experiment, --run, or an Attempt locator.

## Minimal Reproducible Example
pnpm --silent exec niceeval show --experiment harness/v0.14.2 --all

退出非零；去掉 --all 可运行。artifacts/response.txt 保存本轮实测，artifacts/doc-excerpt.txt 保存冲突文档片段。

## Context
历史 @1JVT5N7KQ1FG1 的 execution 中也有被测 agent 读随包指南后调用同一不兼容组合并失败。质量最终满分仍掩盖这次额外往返。
