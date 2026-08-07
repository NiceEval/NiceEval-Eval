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

开放式回复不靠结构化 `niceeval show` 或 record parser。原生断言按事实分工：`calledTool` 用窄
命令锚点分别确认本轮调过 `niceeval exp local` 与 `niceeval show`；`eventOrder` 的目标契约用带
数据的 event group matcher 表达 `exp → show → assistant message`。LLM judge 再拆成三个独立
维度：workflow judge 判断真实调用的语义顺序，execution judge 判断 CLI 输出的计数与分类，
response judge 判断诊断和复验结论。turn 天然限定本轮，不需要累计游标。

当前随包 NiceEval 的 `eventOrder` 仍只接受事件类型字符串，尚不接受上述 tool/message matcher；
Harness 有意直接写目标 API，让类型检查明确暴露框架缺口。在 NiceEval 补齐 matcher 及运行时匹配
前，Harness 的 `eventOrder` 断言不能执行，这不是用类型断言掩盖的兼容分支。

其它原生断言只验证各自擅长的事实：`includes` 检查明确源码值，`equals` 检查结构化配置，
`runCommand` + `commandSucceeded` 运行隐藏 black-box 行为测试，`succeeded` 检查 turn 正常结束。
不维护全仓文件清单或逐字节防作弊 allowlist。Evaluator 不替 agent 运行或重跑内层 experiment，
也不从 CLI/record 解析 verdict。0.12+ 与 0.9.x 的 rerun/carry 契约由候选版本感知的 judge rubric
分别判断。

三题改用 `defineScoreEval`：核心闭环仍是 gate；诊断、回归质量、范围纪律、隐藏行为与完整复验
分别记分，因此除了最终成败，还能看出文档在哪一步开始失效。

Harness 不预设 agent 必须读取哪一篇随包页面，也不维护页面路径白名单。候选版本、随包索引和
初始化产物由候选物化与镜像构建负责校验；文档是否真正有效，由上述行为与产出体现。

## 运行成本

每个版本选中 3 道题，每题运行 3 次，避免把 coding agent 的单次随机性误判成候选文档差异；
因此完整 `niceeval exp harness` 是 3 版本 × 3 题 × 3 次，共 27 个付费 coding-agent attempt，
且每次包含多个 judge 评分点。日常验证运行 `niceeval list` 和各版本的 `--dry`；typecheck 在
matcher-based `eventOrder` 落地前会有意暴露该目标 API 缺口。没有用户明确批准时不启动真实模型运行。
