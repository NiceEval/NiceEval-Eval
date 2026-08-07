# Harness 评估套件

这组题评估 coding agent 能否在一个已经接入 NiceEval 的项目里，自主完成“运行 → 读反馈
→ 定位 → 修改 → 复验”。当前只保留三道可运行题，全部使用 NiceEval 0.12.0 的确定性小项目。

## 当前三题

| 用例 | 用户交互 | 主要能力 |
| --- | --- | --- |
| `run-existing` | 一轮：请 agent 跑一下 `local` | 发现并运行 experiment，主动确认最终结果 |
| `repair-failing` | 两轮：先调查 failed，再要求修好 | 从 locator 找到断言失败，只修业务实现并复验 |
| `repair-errored` | 两轮：先调查 errored，再要求修好 | 区分执行错误与断言失败，只修配置层并复验 |

三题的 `repo/` 都不携带 `.niceeval`。结果必须由被测 agent 当场运行 experiment 产生，避免
把不断变化的 report/reader schema 变成题目的隐藏依赖，也不存在让 0.9 与 0.12 reader 共同
解释同一份历史结果的问题。

## 题面原则

- 每次 `t.send()` 都像真实用户说话，只表达当轮需求；
- 不告诉 agent 应使用哪些 NiceEval 命令、结果存在哪里、根因属于哪一层；
- 不在题面列答案字段、统计口径或判分清单；
- 需要先调查再修改时，用同一 session 的两轮 `send` 表达自然的用户推进；
- 是否运行 experiment、发现 locator、使用 `show` 和正确复验，由隐藏判分观察。

多轮不是把一份操作手册拆成两条消息。第一轮应形成可独立检查的诊断，第二轮才给予新的
用户授权或目标；agent 必须延续上下文，而不是重新开始。

## Folder-local 契约

每道活跃题都是完整、独立的题包：

```text
<id>/
├── eval.ts       # 简短题面、交互顺序和隐藏判分
├── README.md     # 维护者设计说明，不上传给 agent
└── repo/         # 不含 .niceeval 的完整起始项目
```

题包不从兄弟目录或中央 fixture 借起始数据，也不使用共享 fixture helper。`repo/` 里的
TypeScript 文件以 `*.fixture` 结尾，只是为了避开宿主 discovery；每题在首轮 `send` 前自行
上传、恢复文件名、安装候选版本并运行 `niceeval init`。

## 隐藏判分

三题共同检查：

- agent 确实自己运行过 `niceeval exp local`；
- 结论不是只从 shell 退出码猜出；
- 需要诊断时实际下钻过 attempt locator；
- 修复题至少经历“失败运行 → 修改 → 重跑”，最终结果由 evaluator 独立复验；
- 不通过修改 eval、断言或 experiment 制造绿色；
- 文档来自当前候选随包 `INDEX.md`，不退回在线 main 文档。

读取 `.niceeval` 原始文件不预先判错，但也不会替代正确的状态语义和最终复验。

## 未来候选

以下目录只保留 README，不参与 discovery，也不携带 repo：

- `agent-actual-approach`：运行后从 execution 还原实际方案；
- `best-tradeoff`：当场生成多组结果后做公平比较；
- `stale-experiments`：当场生成基线，再制造局部 fingerprint 变化，评缓存与局部重跑。

等 execution/report、比较视图和 plan/cache 契约稳定后，再按“不签入历史 `.niceeval`”的原则实现。

## 运行成本

当前一次 Harness experiment 共 3 个付费 coding-agent attempt。日常验证只运行 typecheck、
`niceeval list` 和 `niceeval exp harness --dry`；没有用户明确批准时不启动真实模型运行。
