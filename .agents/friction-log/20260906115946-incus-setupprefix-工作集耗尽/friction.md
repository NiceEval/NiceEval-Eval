---
title: 'Incus SetupPrefix 工作集耗尽 20 个 artifact 槽位，实验准备阶段反复失败'
severity: 'major'
target: 'CorrectRoadH/niceeval'
---

2026-09-06 执行 pnpm exec niceeval exp：18 个位置仅 5 个完成，13 个未派发；Setup prefixes 为 0 hit / 13 prepared / 29 failed。固定 Run：b89f5bc6-042a-4ad6-8954-f90be3251703（harness/v0.14.3）与 42a4b6e0-bc16-4ef5-8067-cc677655d734（harness/canary）。只读复现：pnpm exec niceeval sandbox provider doctor incus --development 返回 exit 1；runtime capacity 4 free of 4，artifact-inventory 匹配 20 active intents，artifact-capacity no free prepared artifact slots (20/20)。报错要求 Raise artifactMaxInstances or reduce the active SetupPrefix working set。期望：按完整矩阵准备工作集做容量预检并及早报告，避免确定性容量不足继续重复准备；提供明确、保留归属校验的缓存退役维护路径。当前仅记录诊断，未调整宿主配额、清缓存或重跑。另有一次 volume allocation intent 错误，但本次只读检查该 custom volume 已不存在，尚未复现，不据此断言账本损坏。
