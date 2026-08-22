---
title: 'project-current show 可见结果仍被 latest source barrier 阻止复用'
severity: 'major'
target: 'CorrectRoadH/niceeval'
---

## 现象

无参数 `niceeval show` 的 project-current 视图仍能显示当前身份下的历史结果，但 `niceeval exp harness --dry` 对相同 experiment/eval 给出 `source-member-missing` 或 `attempt-outcome-ineligible`，实际运行显示 `0 reused`。

## 最小复现

1. 先发布一个当前身份下 completed、passed/failed 的 Run A，确认无参 `niceeval show` 可见。
2. 对同一 experiment/eval 发布更新的 interrupted/errored/not-dispatched Run B。
3. 再运行无参 `niceeval show`，旧的 current-identity 结果仍可见。
4. 运行 `niceeval exp <experiment> --dry`。

实际：reuse planner 按 `(startedAt, runId)` 选择最新 Run B 作为 source barrier，因 outcome/member 不合格形成 gap，且禁止回扫 Run A。

期望：project-current 可见性与自动复用共享同一份“当前可用结果”状态；能在无参 show 中作为当前结果显示的 slot 应能被 reuse，身份变化则应先 accept、未 accept 时也不应作为 current show 结果。

## 证据

`src/runner/reuse-plan.ts` 的 `latestSourceRun()` 后只检查该 Run；`docs/feature/experiments/cache.md` 明确 source barrier 禁止回扫。`src/sample/analysis.ts` 的 project-current 则独立按 matching occurrences 做 identity narrowing。两条选择路径可产生分叉。
