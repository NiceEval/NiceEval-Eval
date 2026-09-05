---
title: 'Public assertion detail fails on recorded negative tool assertion'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior
公开 attempt.get 返回的 entryId 应能通过 attempt.assertion.detail 下钻，或明确返回材料不可用。

## Current Behavior
固定 Run 61c4eb43-99ef-4a68-ad86-d8b98dfbd2b8 的 @1P59ARB674QRB，entryId ae_1e6d1a044150db51031e（harness.regex-log.public-evidence）连续两次返回 inspection-operation-failed，correction=retry；同一 Attempt 其余九项可正常读取。

## Minimal Reproducible Example
在本项目通过 pnpm --silent exec niceeval query run --request - 输入 artifacts/request.json。实际失败响应见 artifacts/response.json。使用当前 workspace-linked niceeval 构建读取历史 Run；尚未定位实现根因。

## Impact
不能完成禁止读取私有 Record 这一负向工具断言的公开审计，不能将此读取错误当成 assertion 不通过或零分。
