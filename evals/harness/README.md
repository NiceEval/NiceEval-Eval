# Harness 评估套件

这组题评估 coding agent 能否在项目**已经接入 NiceEval 之后**，正确操作 Harness
完成“选择与运行 → 读取结果 → 下钻证据 → 修复与复验”反馈闭环。

能力归属 Harness，不归属某个 experiment。`experiments/harness/*.ts` 里的版本与
`harness-v*` tag 只用来选择当前 reader 能完整读取的 fixture，不是评估能力的分组。

## 评估边界

Harness 评估应覆盖：

1. 发现并选择正确的 experiment / eval；
2. 理解运行计划、缓存、重跑范围与退出状态；
3. 从概览收窄到 experiment、eval、attempt 和具体 assertion；
4. 正确比较通过率、成本、覆盖率和可观测指标；
5. 用 source、execution、diff 和 timing 等公共证据还原真实失败原因；
6. 区分 assertion `failed`、基础设施 `errored` 和未采集/不存在的数据；
7. 修正该修的业务层，局部重跑，并独立确认最终结果。

不在这组重复评估：NiceEval 的首次安装、Adapter / Eval / Experiment 创作质量、
核心 reader 的 schema 兼容性、报告站视觉效果、CI 发布以及 NiceEval 核心实现的单元正确性。

## 能力模型与现有用例

| 能力 | 应观察的行为 | 现有用例 |
| --- | --- | --- |
| 运行与确认 | 运行正确的 experiment，并主动确认 verdict 与计数，不把进程退出码当成唯一证据 | `run-existing` |
| 概览与时效性 | 读懂 stale 与覆盖警告，识别哪些结论需要重跑 | `stale-experiments` |
| 公平比较 | 先对齐覆盖范围，再综合比较通过率与成本 | `best-tradeoff` |
| 状态分诊 | 区分 `failed` 与 `errored`，不把基础设施故障当作评估不通过 | `errored-vs-failed` |
| 失败定位 | 从 eval + experiment 收窄到失败 assertion 和 attempt locator | `failed-assertion` |
| 执行证据 | 用 `--execution` 还原 agent 实际方案，区分方案变更与机械重试 | `agent-actual-approach` |
| 可观测覆盖 | 识别指标只覆盖部分 experiment，不把局部证据外推成全局结论 | `ttft-partial-coverage` |
| 数据边界 | 指标未采集时明确说无法回答，不编造数值 | `nonexistent-metric` |
| 实体边界 | experiment 不存在时拒绝按命名规律补全结论 | `nonexistent-experiment` |
| 修复闭环 | 复现失败、用 locator 下钻、只修业务层、重跑到全绿并再次核对 | `repair-failing` |

这些用例不应被解读为“某个版本只评某种能力”。fixture 的版本只是可重现的
输入条件；更新 reader 或重生 fixture 后，同一能力可以放进任何候选版本的运行格。

## 横切验收原则

除每题的业务答案外，Harness 用例还应统一检查：

- `t.send()` 只发送一句真实用户会提出的需求，不交代项目已使用 NiceEval、结果存放位置、
  应检查的实体、统计口径、预期答案结构或操作步骤；
- 题面不提示 agent 应使用 `niceeval show`，也不禁止读取 `.niceeval` 原始记录；工具选择、
  调查范围和汇报结构都属于被评能力；
- 诊断题保持仓库只读，不为了得到绿色结果篡改 eval、experiment 或 assertion；
- 修复题用独立复验命令判定完成，不只信 agent 最终回复；
- 是否发现并实际使用 `niceeval show`、locator 及合适的下钻 flag，是从 agent 行为中
  评估的能力点；直接解析原始记录不预先判错，但必须检查其结论是否可靠、是否遗漏
  CLI 已提供的状态、覆盖范围或证据语义；
- 通过 `niceeval init` 托管指针进入当前安装版本的 `INDEX.md`，不退回在线 main 文档；
- 数据缺失、覆盖不全或实体不存在时，必须缩小结论边界。

## Folder-local 题包契约

每个 `evals/harness/<id>/` 都是独立题包：

```text
<id>/
├── eval.ts       # 题面、过程约束和判分
├── README.md     # 给维护者看的中文设计说明；不上传给 agent
└── repo/         # agent 开始工作时拿到的完整起始仓库
```

题包不能从兄弟题包或中央 `fixtures/` 借起始数据。删掉任意一个兄弟目录后，
剩下的题仍应能独立发现、上传和运行。公共 helper 只封装上传、TypeScript 恢复、
reader 安装和横切边界，不保存题目、答案或 fixture 路径。

`repo/` 里的 TypeScript 文件在宿主机上使用 `*.ts.fixture` 后缀，避免被外层 NiceEval
discovery 或 TypeScript 误收。上传后在 `t.send()` 前恢复原名，该恢复不进入 agent diff。

## 当前覆盖缺口

现有 10 题已覆盖结果解读、比较、失败分诊、execution 证据、可观测边界和修复闭环，
但还缺四类独立证据：

1. **发现与 dry plan**：从未知项目中找到正确 experiment，用 `--dry --json` 确认计划；
2. **source / diff 下钻**：当回复、源码与最终 diff 不一致时，选择正确证据面；
3. **缓存与局部重跑**：识别 carried results，只作废受影响的 eval / attempt；
4. **中断恢复与清理**：从强杀或超时中续跑，并正确收回 sandbox / teardown 资源。

新增题应优先填这些缺口，而不是为了某个候选版本再复制一套已有能力。

这些缺口在 MemoryBench 与 terminal-bench 的真实维护中都出现过：

- 大量结果显示为 `new` 时，先区分“从未运行”、`errored`、身份变化和可承接历史结果，
  而不是直接全量重跑；
- 历史结果提示 stale 或 details unavailable 时，检查执行证据是否仍完整，再决定 accept
  还是重跑；accept 之后还要重新检查计划；
- 一批 attempt 连续 errored 时，从结果定位到 sandbox 用户、运行时权限或缺失工具，修正
  共享环境后只补跑受影响的 eval，保留其余 carried results；
- accept 后同一批 Compose 题仍反复 stale 时，继续追到不稳定的 case identity，而不是重复
  accept 或机械重跑。

因此，新增题的题面应保持为“为什么这么多 new”“这次评估怎么挂了”“把这批无效结果
处理好”这类一句话真实请求。不能写成“哪些 experiment errored、哪些整组 errored、共有
多少 attempt、它们与 failed 有何区别”这种答案提纲；这些事实应由 agent 自主发现，再由
隐藏判分检查是否找全。判分同时观察 agent 是否自主选择 dry plan、结果下钻、accept、
局部 rerun 和最终复核。

## 数据身份与运行成本

历史诊断题的 `repo/` 各自携带 NiceEval 0.4.6 写出、由 0.9.1 reader 验证的 schema 8
真实记录；运行与修复题则各自携带确定性小型项目。这些是 fixture 身份，不是能力分组。

当前共 10 个付费 coding-agent attempt。日常验证只运行 `pnpm run typecheck`、`niceeval list`
和 `niceeval exp harness --dry`；没有用户明确批准时，不启动整套真实实验。
