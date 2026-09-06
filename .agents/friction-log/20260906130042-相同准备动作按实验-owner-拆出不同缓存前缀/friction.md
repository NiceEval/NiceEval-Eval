---
title: '相同准备动作按实验 owner 拆出不同缓存前缀，Incus dir 重复保存完整 VM'
severity: 'major'
target: 'CorrectRoadH/niceeval'
---

2026-09-06 真实复验18个位置，在任何Attempt派发前已累计43份缓存；起始已有20份。公开 niceeval debug harness/v0.14.0 harness/terminal-bench/log-summary --json 与 v0.14.3、canary 的 prepare-inner-runtimes 和 upload-harness-seed 动作 combined fingerprint 完全相同，但 cache.prefixIdentity 各不相同。源码 runner/setup-prefix-plan.ts 的 actionManifest 含 owner.kind/id/ordinal，且 replacementScope 含完整 actionManifest，导致实验名称进入公共准备缓存身份，内容变化又留下独立保留链。现场 Incus driver=dir，每份VM根盘实占6.8至6.9GiB，池累计约296GiB；43份后磁盘剩约80至90GiB。已正常SIGINT停止未派发的复验，临时VM清理完毕；随后用公开 --sandbox-setup-cache bypass 继续原矩阵，避免继续逐步骤复制VM。需跟进公共不可变准备层的语义去重、合理捕获检查点与可审计的历史缓存退役，不能把增加实例配额当成空间效率修复。不得仅凭同名或同脚本跨不同执行域复用，须保留真实状态与信任边界。

公开调试输出的对比证据见 [public-debug-comparison.json](artifacts/public-debug-comparison.json)。
