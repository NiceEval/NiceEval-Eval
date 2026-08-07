# 候选题：缓存、stale 与局部重跑

状态：未来设计稿，不参与 eval discovery。

## 为什么值得保留

MemoryBench 与 terminal-bench 都出现过大量 `new`、accept 后仍 stale、以及只应补跑少量
errored eval 的真实问题。这比单纯读取状态更能体现 Harness 使用能力。

## 重做方向

- 起始仓库不携带 `.niceeval`，由第一轮当场跑出基线；
- evaluator 在两轮之间改变一个会影响部分 fingerprint 的输入；
- 第二轮用户只问“为什么这么多 new？”或“把该补跑的处理好”；
- 隐藏判分检查 agent 是否区分 carried、missing、errored 与身份变化，并避免全量机械重跑。

等 plan/cache/report 契约稳定后再实现。
