# 成本与通过率权衡

## 项目

`repo/` 是同一真实 memory benchmark 的独立起始仓库。compare 组同时包含 Claude、Codex、Bub 以及
不同 memory 条件；各组覆盖题数并不完全相同，成本和通过率也有明显跨度。

仓库携带 NiceEval 0.4.6 写出的 schema 8 历史结果，由 harness 固定使用 0.9.1 reader 查询。

## 希望测试的内容

- agent 是否自主选择适合的结果视图，并正确比较 experiment；
- 是否先排除只覆盖少量 eval 的 100% 结果，避免把不可比样本放进排名；
- 是否同时报告 experiment id、通过率和总成本；
- 是否能说明自己的权衡口径，而不是只挑最高通过率或最低成本。

这题测 compare 层的信息阅读；精确答案断言不依赖 LLM judge。
