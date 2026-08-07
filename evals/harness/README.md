# Harness 评估套件

这组题评估 coding agent 能否在一个已经接入 NiceEval 的项目里，自主完成“运行 → 读反馈
→ 形成因果判断 → 在正确层修改 → fresh full rerun”。三题共享运行基建，但各自维护独立项目。

## 当前三题

| 用例 | 用户交互 | 初始状态 | 主要能力 |
| --- | --- | --- | --- |
| `add-regression` | 两轮：先新增 eval 复现，后修实现 | 5 passed → 5/1/0 → 6/0/0 | 识别覆盖缺口、写有效回归、红绿闭环 |
| `repair-failing` | 两轮：先归因，后分层修复 | 3 passed / 2 failed | 区分业务实现错误与过期 eval，再全量复验 |
| `repair-errored` | 两轮：先调查，后只修配置 | 3 passed / 2 errored | 判断局部 blast radius、错误层级与共享运行时根因 |

## 共享基建，独立 repo

Node、pnpm、Docker/Compose、精确候选 NiceEval、依赖和 `niceeval init` 产物在候选镜像中
共享。0.9.0、0.12.0 与解析后的 canary 各有独立缓存镜像。

`fixtures/harness/<case>/repo/` 则由每道题各自维护：覆盖缺口、双层 failed 与局部 errored
状态直接写在所属 repo，不靠中央 canonical fixture 加 evaluator overlay。Attempt 启动时只
上传这一份几 KB 的 repo；不改扩展名、不安装依赖、不执行 init。fixture 修改也不会使 Docker
依赖层失效。

## 题面原则

- 每次 `t.send()` 都像真实用户说话，只表达当轮需求；
- 不告诉 agent 应使用哪些 NiceEval 命令、结果在哪里或根因属于哪一层；
- 第一轮要求“暂时别改业务”时，先形成可独立检查的诊断或失败复现；第二轮才授权修复；
- 项目不携带 `.niceeval`，结果必须由被测 agent 当场运行产生。

## 判分边界

开放式回复不靠正则、结构化 `niceeval show` 或 record parser。每轮开始前记录宿主侧
`t.o11y.shellCommands` 游标，结束后把“该轮原始回复 + 该轮真实命令及退出状态”作为一份 JSON
材料交给 LLM-as-judge。命令摘要位于宿主，sandbox 内的 agent 无法伪造；judge 可以语义判断
各种合法命令形态，而不需要维护命令正则。状态计数、failed/errored 分类、locator 下钻、因果
归属与复验陈述必须同时得到回复和过程证据支持。

机器只判断机器更可靠的事实：第一轮允许的精确文件范围、第二轮 diff allowlist、目标配置、
回归 eval 是否保留，以及 agent 离场后运行的隐藏 black-box probe。Evaluator 不替 agent 运行
或重跑内层 experiment，也不从 CLI/record 解析 verdict。0.12+ 与 0.9.x 的 rerun/carry 契约由
候选版本感知的 judge rubric 分别判断。

三题改用 `defineScoreEval`：核心闭环仍是 gate；诊断、回归质量、范围纪律、隐藏行为与完整复验
分别记分，因此除了最终成败，还能看出文档在哪一步开始失效。

Harness 不预设 agent 必须读取哪一篇随包页面，也不维护页面路径白名单。候选版本、随包索引和
初始化产物由候选物化与镜像构建负责校验；文档是否真正有效，由上述行为与产出体现。

## 运行成本

每个版本选中 3 道题，每题运行 3 次，避免把 coding agent 的单次随机性误判成候选文档差异；
因此完整 `niceeval exp harness` 是 3 版本 × 3 题 × 3 次，共 27 个付费 coding-agent attempt，
且每次包含多个 judge 评分点。日常验证只运行 typecheck、`niceeval list` 和各版本的 `--dry`；
没有用户明确批准时不启动真实模型运行。
