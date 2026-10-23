# Harness 文档工作流评估 · rubric v2

这组题评估 coding agent 在已接入 NiceEval 的项目里，能否运行、归因、恢复执行错误和编写
可信评估。当前是 **三个任务家族、四个独立条件**，不是四种独立能力样本。
候选安装和 `init` 已由 Harness 完成；安装前 `INIT.md` 的效果另由 `evals/install/` 测量。

| 条件 | 请求与起始状态 | 分值 |
| --- | --- | --- |
| regex-log | 自主完成；首跑 2 passed / 1 合法 failed / 1 缺 Python errored | 10 |
| regex-log-authorized | 相同 fixture，明确要求修复执行错误后复验 | 10 |
| log-summary | 已跑完 1 passed / 2 failed，只分析、不改动、不重跑 | 14 |
| cancel-async-authoring | 编写正式 Eval，隐藏判据、真实正反控制及 fingerprint | 18 |

满分合计 52。**不能将 v2 分数与历史 32/48 相减**：题面、评分与推理设置均需重新建立基线。
A 的两个条件使用相同 fixture 和 scorer，但使用独立 Sandbox 与单轮会话，不串行提示同一 agent。

## 评分在评什么

A 的目标是最终保留 `hello-world`、`fix-permissions`、`regex-log` passed 与 `classifier-debug`
failed。每个控制用例正确各 1 分，真实恢复 regex-log 3 分，区分环境依赖与业务失败 2 分，
如实交接 2 分。只诊断未修复者仍能取得诊断、诚实交接与已完成控制项的分数。
不奖励特定镜像字符串或 `show` 命令拼写；允许在 `experiments/local.ts` 中配置等价运行环境。

外层在 agent 结束后仅用公开 `runs.list` 固定 Run 集合，再读取逐个固定 `run.summary`，
以时间顺序取 local 的各用例最后一个 Member。只复跑受影响用例也可完成任务；旧控制项保留
它们的 Run ID、locator 和 executed/carried/accepted 状态。后续退步不能挑旧成功来遮盖。
原有题面、Agent 与判据若被改写，结果分不给分。外层不会替 A 重跑、accept 或 migrate。

B 每个失败仍是公开证据 2、任务事实 2、责任归因 3 分。`show` 与 `query` 的等价证据都接受，
不强制命令顺序或 locator 拼写。外层用公开结果验证初始状态，并比较前后 Run 集合；
`noChanges` 与 `no-new-runs` 分别记录文件和新发布结果边界。没有新 Run 不证明没有发起失败命令。
归因仍使用 Judge：输出有开放性，不能用出现 A/B 或 CSV 等词代替正确解释。

C 不使用 Judge，18 分来自：只改目标文件 1、官方资产未改 2、discovery 2、oracle 6、
fingerprint 自动新执行 2、leak-probe ordinary failed 3、强制失败判据确实使 oracle failed 2。
最后一项由外层在官方测试末尾增加必失败测试，检验未执行 tests 或忽略退出码的假成功；
探针结束后在 finally 恢复测试文件。oracle 与 leak-probe 用 `--rerun all` 保证外层实际验收，
fingerprint 探针刻意不加重跑参数。结果来自固定 Run 的公开 JSON，不解析终端汇总文案。
agent 自己是否跑过正反两格在外层验收开始前单独取证，不能由外层运行补作业。

## 分数与完成必须分开报告

计分制的高分不自动证明任务完成。每次同时审阅：

- A：`task-complete`、`changed-only-config`、`assets-unchanged`、Turn 状态和公开证据边界。
- B：两项归因与事实得分、`no-changes`、`no-new-runs`、Turn 状态和公开证据边界。
- C：产物分数、`student-runs`、`target-only`、`assets-unchanged` 与公开证据边界。

`.niceeval` 负向工具匹配只证明没有观察到禁止路径，不是 OS 文件访问审计。Adapter 的 shell
内部 argv 可能不可见，因此不按不可观察的命令序列设置硬门禁。公开 query 失败、截断或成员
身份不闭合时 verifier 抛出错误，结果不可排名，不能静默变成零分。空 Record 则是确定的“没有运行”。

## 题库质量与适用边界

B 的两类相似 failed 要求不同责任归因，C 用真实测试和反例检查产物，适合工作流回归。
A 配对能区分任务理解/自主恢复和明确授权后的执行能力。它们仍只有三个任务家族，且均为
开发集；重复 Attempt 增加行为稳定性的证据，不增加场景覆盖。canned agent 稳定制造问题，
不能用这些结果推断真实模型解决 Terminal-Bench 的能力。

保留题必须在调文档前冻结，使用不同依赖、合法失败与输出格式；只更名或替换固定答案不够。
一旦看过失败并据此调优，就移入开发集。本轮没有新增已宣称为盲测的保留题。
完整安装链、多轮交互、复杂接入和不熟悉的任务仍需独立测试，不由这四个条件代替。

## 验证与发版后重跑

```sh
pnpm run typecheck
pnpm test
pnpm exec niceeval exp harness/canary --dry
pnpm harness-report <fixed-run-id> [<fixed-run-id> ...]
```

`pnpm test` 用临时项目真实运行确定性 CLI，不使用 LLM 或 Docker，不写本项目历史 Record。
它验证空结果、合法 failed、执行错误、局部修复、沿用、后续退步和证据结构错误。
`harness-report` 只读取指定 Run，输出逐题分数、来源、覆盖和用量；不从 Score 推断边界合规，
不将 carried/accepted 当新样本。同一 Attempt ID 跨多个 Run 出现时也只算一个独立样本。

目前三个候选均固定 `gpt-5.6-terra`、`reasoningEffort: medium`、1 Attempt、不开首过即停。
单候选最多 4 个 coding-agent attempts，三候选完整矩阵最多 12 个，A/B 另有 Judge 调用。
预检与真实模型请求共用网关配置；发版后付费重跑前仍须完成 VM 内真实请求复验并确认预算。
`canary` 每次解析精确版本，跨日比较不能只记录标签。

发版比较流程及量化口径见 [发布评估协议](../../docs/harness-release-evaluation.md)。
共享基建与来源见 [fixture 说明](../../fixtures/harness/README.md)，旧 rubric 证据见
[2026-09-05 审计](../../docs/harness-review-2026-09-05.md)。
