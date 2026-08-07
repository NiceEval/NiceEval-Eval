# 区分 errored 与 failed

## 项目

`repo/` 的历史结果同时包含断言失败与运行基础设施错误。有两组 Codex memory 变体整组没有形成可判定
结果，另有上游网关的不同 HTTP 失败。首屏的 0% 不能说明是模型没完成任务还是 harness 没拿到结果。

每个用例拥有自己的完整快照，因此本题可以独立运行，不依赖其它题先找出 locator。

## 希望测试的内容

- agent 是否从 experiment 汇总钻到具体 errored attempt；
- 是否准确区分 `failed`（有断言 verdict）和 `errored`（执行链未形成 verdict）；
- 是否报告主要错误码、网关状态及受影响的 experiment；
- 是否避免把基础设施错误计作模型能力失败。

这题测试 status 语义与诊断下钻，不测试修复或重跑。
