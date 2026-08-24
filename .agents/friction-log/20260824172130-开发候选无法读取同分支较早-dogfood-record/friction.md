---
title: '开发候选无法读取同分支较早 dogfood Record'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

同一开发分支的新候选应能通过公开 `niceeval show @<locator> --execution` 读取该分支较早候选生成的 dogfood Record，或至少说明可使用的精确 reader 版本。

## Current Behavior

在 `/home/ctrdh/.herdr/worktrees/NiceEval-Eval/docker-fast` 用 consumer-link 安装当前 `docker-cache-more` 候选后，读取本轮较早真实 dogfood locator `@1ZQ8A8T4DM53W` 只返回 `record-format-unsupported`。CLI 没有给出 writer 版本或可执行的恢复命令，因此无法用公开入口复核已经保存的 setup-prefix hit 与时序。

## Possible Solution

在 Record 元数据和 unsupported 输出中保留 writer/package/schema identity，并提供能定位兼容 reader 的命令；同一 feature 分支的 schema 迭代还应明确迁移或兼容策略。

## Minimal Reproducible Example

1. 在 NiceEval-Eval `docker-fast` 用较早的 `docker-cache-more` 候选运行现有 Harness，保留 locator `@1ZQ8A8T4DM53W`。
2. 用 `pnpm consumer:link apply /home/ctrdh/.herdr/worktrees/NiceEval-Eval/docker-fast` 安装当前候选。
3. 运行 `pnpm --silent exec niceeval show @1ZQ8A8T4DM53W --execution`。
4. 观察唯一输出为 `record-format-unsupported`，且没有 writer identity 或兼容 reader 定位方式。

## Context

本轮 DinD setup-prefix PR 收尾时需要通过公开 CLI 重读先前 dogfood 证据。新候选本身 typecheck、debug 与 E2E 均通过；问题只影响既有 Record 的公开复核。
