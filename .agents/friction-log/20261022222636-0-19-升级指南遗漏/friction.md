---
title: '0.19 升级指南遗漏 query 操作撤销，旧 runs.list 和 run.summary 无法使用'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

复现：安装 niceeval@0.19.0，按随包 tutorials/upgrade-0-19.mdx 将 query protocol 改为 niceeval.query/v2，继续请求 runs.list 或 run.summary，得到 inspection-request-invalid。公开 query discover 只列 run.list、run.get 等新入口；run.get 已整合原 summary/overview 字段。升级指南仅说明 plannedAttempt 字段更名与 v2，没有列出 operation 和响应结构迁移。期望补齐操作映射、run.get 的 value/plannedAttempts/denominator 读取示例。本项目通过公开 discover 及随包类型核对后迁移。

证据：`artifacts/discover.json` 是 0.19.0 的公开操作列表；`artifacts/request.json` 可传给 `niceeval query explain --request` 复现旧操作不被接受。
