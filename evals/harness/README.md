# Harness 评估套件

这组题评估 coding agent 能否在一个已经接入 NiceEval 的项目里，自主完成“运行 → 读反馈
→ 定位 → 修改 → 复验”。当前三道题各自拥有一份包含五个确定性 eval 的小项目。

## 当前三题

| 用例 | 用户交互 | 初始状态 | 主要能力 |
| --- | --- | --- | --- |
| `run-existing` | 一轮：请 agent 跑一下 `local` | 5 passed | 发现、运行并准确汇报完整结果 |
| `repair-failing` | 两轮：先调查，后授权修复 | 3 passed / 2 failed | 区分两条断言失败，只修业务实现并复验 |
| `repair-errored` | 两轮：先调查，后授权修复 | 5 errored | 区分执行错误与断言失败，只修配置并复验 |

## 共享基建，独立 repo

Node、pnpm、Docker/Compose、精确候选 NiceEval、依赖和 `niceeval init` 产物在候选镜像中
共享。0.9.0、0.12.0 与解析后的 canary 各有独立缓存镜像。

`fixtures/harness/<case>/repo/` 则由每道题各自维护：正常、failed、errored 状态直接写在所属
repo 里，不靠中央 canonical fixture 加 evaluator overlay。Attempt 启动时只上传这一份几 KB
的 repo；不改扩展名、不安装依赖、不执行 init。fixture 修改也不会使 Docker 依赖层失效。

## 题面原则

- 每次 `t.send()` 都像真实用户说话，只表达当轮需求；
- 不告诉 agent 应使用哪些 NiceEval 命令、结果在哪里或根因属于哪一层；
- 第一轮要求“暂时别改”时，先形成可独立检查的诊断；第二轮才授权修复；
- 项目不携带 `.niceeval`，结果必须由被测 agent 当场运行产生。

## 判分边界

开放式回复不再靠正则、结构化 `niceeval show` 或 record parser。每一轮所需的
状态计数、失败/错误分类、根因、修复范围和最终复验结论，都由该 turn 的 LLM-as-judge 直接
判断。judge 看的是 agent 的原始回复，不要求固定措辞，但会要求完整的事实。

机器只判断机器更可靠的事实：turn 是否正常完成、第一轮是否真的保持只读、最终是否修改了
目标层、关键配置/业务值是否恢复，以及绿色项目是否保持零 diff。Evaluator 不代替 agent
运行或重跑内层 experiment，也不解析任何 CLI 文本来猜 verdict。

Harness 不预设 agent 必须读取哪一篇随包页面，也不维护页面路径白名单。候选版本、随包索引和
初始化产物由候选物化与镜像构建负责校验；文档是否真正有效，由上述行为与产出体现。

## 运行成本

每个版本的 Harness experiment 有 3 个付费 coding-agent attempt，且每个有 judge 调用；运行
`niceeval exp harness` 会选中三个版本、共 9 个 attempt。日常验证只运行 typecheck、
`niceeval list` 和各版本的 `--dry`；没有用户明确批准时不启动真实模型运行。
