# 2026-10-28 判据校准：按 NiceEval Taste 修题

上一轮 12 格全部有分后（见 [validation-2026-10-26](validation-2026-10-26.md)），本轮不看总分高低，只回答一个问题：
**这些分数能不能区分文档的好坏。**用随包 `niceeval-taste.mdx` 的自检清单审题库，结论是两类问题：

1. Harness 四个条件在两个版本上几乎都是满分，已经量不出差别。
2. 安装题有一批评分项**在所有 Attempt 上恒为 0**。逐条读 Judge 理由后发现，其中多数不是 agent 做错，
   而是判据本身问错了问题。

## 安装题：恒定项审计

逐项读取四个安装 Attempt（DB-GPT `@1S65M11H50NXP` / `@10G1Z2FTQCXE9`，GPT Researcher
`@1DZRDKANTMZKH` / `@123SDGS5X8MRJ`）的 `attempt.assertion.detail`。下表列出四格都是 0 分的项：

| 评分项 | 四格得分 | Judge 理由的要点 | 归类 |
| --- | --- | --- | --- |
| `adapter.target-protocol`（8 分） | 0/0/0/0 | Agent 用的是真实路由（DB-GPT `/api/v1/chat/react-agent`、GPT Researcher `/ws`），但材料里没有目标仓库源码，Judge 无法确认，只能判 N | **Judge 缺材料** |
| `first-turn.protocol` / `capability` / `use-case` | 全 0 | 理由要求说出出题人预设的那条路径或那组 chat_mode，agent 选了另一条真实路径也判 N | **判据只认一种答案** |
| `adapter.variables-forwarded` | 全 0 | 用户在续轮已决定「沿用服务默认模型」，agent 照做后不转发 model，结果因此判 N | **判据与用户指令矛盾** |
| GPT Researcher `response-mapping` / `target-response` | 2/4 有分 | Canary 的报告正文读自 path 指向的本次报告文件，判据只认 report 帧，所以判 N | **判据只认一种答案** |
| `first-turn.ask-tier` / `ask-model` | 全 0 | 当前 onboarding 文档要求默认推荐 Tier 1，用户要做变体对比时才提 Tier 3；agent 照文档做，却被判 N | **判据落后于文档** |
| `first-turn.ask-budget` / `pause` | 0/0/0/0、1/0/0/0 | 没问预算就直接开跑；文档要求遇到会改变预算的决定时先确认 | 真实文档效果 |
| `experiment.service-start` / `service-cleanup` | 全 0 | Experiment 默认目标服务已在外部启动，没有 lifecycle | 真实文档效果 |
| `taste.stop-on-prerequisite` | 全 0 | Agent 写的 Eval 在 `succeeded()` 后没有 `orStop`，前提失败后仍继续判分 | 真实文档效果 |
| `evidence.handoff` | 0/0（已运行的两格） | 交接只给了泛化的 `view` 命令，没有 locator | 真实文档效果 |

前四类是判据缺陷，修题：

- **删除 `adapter.target-protocol`。**只看源码证明不了协议正确，能证明的事实是真实运行里收到了目标服务的响应。
  这个事实已经由 `evidence.target-response` 这道门槛覆盖，它的分值从 5 提到 10。
  源码里的协议细节由 `response-mapping`（响应怎样映射为消息）和 `source-explains-execution` 承担。
- **首轮三问改成只问业务要求。**`protocol` 只要求说清所选入口和协议形状，并且命令里能看到读过对应的路由源码，不再点名某一条路径；
  `capability` 与 `use-case` 只要求触达目标的差异化能力，原来点名的路径和模式降级为例子。
  GPT Researcher 的报告正文来自 `/ws` report 帧、`POST /report/` 返回的 `report` 字段，或 path 指向的本次报告文件，都算真实报告。
- **`variables-forwarded` 只问静态配置是否被消费。**model 是否被消费，交给 `experiment.config-consumed` 判断；
  用户选择服务默认模型时，不声明 model 或明确拒绝覆盖都算正确。
- **首轮询问项与当前 onboarding 文档对齐。**删去 `ask-tier` 与 `ask-model`，新增 `ask-judge`（onboarding 第 1 步第 6 点要求问
  Judge 的服务与 Key）；保留 `ask-budget`。

后四类保留原样。它们稳定为 0 正是文档效果的信号，不能为了分数好看删掉。修改后总分为 DB-GPT 95、GPT Researcher 82，
与旧分不可直接相减。

## Harness：新增 `log-summary-repair`

`log-summary` 只要求诊断：分清 classifier-debug 是 agent 答错、log-summary 是 Eval 判得过紧。新条件沿用同一个 fixture 和同一个初始
Record，换成用户真正的下一句话：把过紧的 Eval 改对。它测的是 niceeval-taste 文档本身能不能让 agent 写出
**既不过紧也不放水**的判据，这是现有四个条件都没测到的能力。

```text
evals/harness/terminal-bench/log-summary-repair/eval.ts
fixtures/harness/terminal-bench/log-summary/probe-agent.ts   # 只在外层验收时写入，不进 agent 工作区
```

题面（只说需求）：

> local 跑完了，terminal-bench/log-summary 失败了。我看过产物，CSV 本身没问题，是这条 eval 判得太死。
> 把它改好，复验一下，告诉我结果。

题面不提示「错误计数仍然要失败」。不要任意放宽断言，是 INDEX 与 taste 文档应当教会 agent 的事。

### 外层验收

Agent 收工后，外层先读它自己的当前结果，再检查受保护资产（canned agent、task 数据、官方 test.py、
另外两条 Eval）。资产被改就停止，不再计结果分。允许修改目标 Eval 和 `experiments/local.ts`：后者用于改用 Python
runtime 跑官方 test.py，这是合法路线。

随后外层把 canned agent 临时替换为 probe agent。probe agent 用环境变量 `HARNESS_CSV_PROBE` 选择
log-summary 的产物，其它题保持原样。每个探针执行一次
`exp local terminal-bench/log-summary --rerun all`，从 receipt 的唯一 Run 读取 verdict，结束后在 `finally` 中恢复原文件。

| 探针 | 产物 | 正确 Eval 的 verdict | 分 |
| --- | --- | --- | --- |
| （无） | 原 canned 输出：全字段带引号 | passed | 3 |
| `plain` | 不带引号、LF | passed | 2 |
| `crlf-quoted` | 带引号、CRLF | passed | 2 |
| `wrong-count` | ERROR 写成 5 | failed | 2 |
| `missing-row` | 缺 INFO 行 | failed | 2 |
| `extra-row` | 多一行 `DEBUG,0` | failed | 2 |
| `no-header` | 缺表头 | failed | 2 |
| `missing-file` | 不写文件 | failed | 2 |

负向探针要求 `failed`，不接受 `errored`：没有产物是被测对象的业务失败，不是执行错误。
接受探针只用题面和官方 test.py 都允许的变体，不考察行顺序这类有争议的格式。

另有三项：

- **`student-runs`（3 分）**：agent 自己留下的 local 当前结果为 hello-world passed、classifier-debug failed、
  log-summary passed。外层验收不替它补这一步。
- **`handoff`（2 分，Judge）**：交接是否与外层核验的结果一致，是否说明改了什么，是否仍把 classifier-debug 报告为合法失败。
- **`readable`（1 分，Judge）**：只读改后的 Eval 正文，能否说出通过条件。

满分 23。前三类事实全部用确定性检查，只有开放输出交给 Judge。

### 不变的边界

- 不修改现有四个 Harness 条件的源码，避免它们的结果因身份变化作废（`accept` 的身份失配问题仍未修复）。
- 新条件的读取 helper 只供新题使用。现有题照旧，等下次必须改它们时再一起迁移。

## 验收

1. `pnpm run typecheck`、`pnpm test`、`niceeval exp harness/canary --dry` 都能识别新条件。
2. 探针自检（不调用模型）：原过紧 Eval 必须让两条接受探针都 failed；按官方 test.py 语义写的参考 Eval 必须让 8 个探针全部符合预期。
   两组结果都要记录下来。
3. 真实运行：新条件在 `v0.19.0` 与 `canary` 上各跑 1 个 Attempt。
4. 修改后的安装题需要重跑 4 个 Attempt，单个耗时 50–80 分钟。用户确认预算后再跑。
