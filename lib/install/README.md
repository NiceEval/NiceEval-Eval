# install Eval 结构

正式 install 题分别位于 `evals/install/db-gpt/eval.ts` 与
`evals/install/gpt-researcher/eval.ts`。两道题各自持有宿主 fixture、交互续轮、评分与取证逻辑：
DB-GPT 的 HTTP/SSE、数据问答与库表编造风险，不会被 GPT Researcher 的 WebSocket、
研究报告与引用编造判据稀释。修改一题也不会改另一题的源码指纹。

两题直接导出 `defineScoreEval`。候选版本物化、INIT.md 地址与随包页面存在性仍由
`lib/candidate.ts` 统一控制；`lib/install/` 中其余 helper 只供 roadmap 题复用，不是正式
install 评分入口。

## 交互与取证流程

1. 初始 `send` 始终只有两句短工单：读候选 INIT 并在当前仓库安装 niceeval；
   精确安装候选版本。不提前告知 Adapter、Eval、Experiment、locator 或评分证据。
2. 首轮只评 agent 是否自己查明仓库接口和能力边界，提出核心用例、成功结果
   与主要风险，并以 `waiting` 状态询问 Tier、观测、模型和预算等真正用户选择。
3. 只有 agent 主动发出 `input.requested` 时才续轮；每个回答只包含该 request 问到的
   Tier、观测、模型/flags、预算、镜像或凭证边界。未询问时不主动泄露实现答案。
4. 先审查全部可独立取得的 Adapter、Experiment 与 Eval 源码。即使安装、dry planning
   或真实运行失败，这些源码项仍保留诊断与应得分。
5. 安装 gate 通过后，明确的 stub/mock/echo/进程内替代才会截断其后依赖真实性的
   published evidence；「未发现替代物」本身不得分。
6. 只尝试最终交接明确引用的 Attempt locator，不用 bare `niceeval show` 的最后一项
   猜测本轮结果。overview、`--execution` 与 `--source` 必须在同一 locator 上成功；
   Judge 还要核对其 Experiment/Eval/Adapter/Run membership 和证据一致性。
7. `finally` 仍归档 agent 产物，使零分、gate 截断和执行失败的样本也能复审。

## 自然权重

评分是自然价值的累加，不为了凑某个总分而给形式事实发分，也不设“52 分上限”。
两题共享同一价值排序，但每条 Judge rubric 都用各自产品事实判定：

| 维度 | 权重 | 证据语义 |
| --- | ---: | --- |
| Adapter | 8 | 真实目标协议与请求/响应语义正确 |
| Adapter | 6 | 真实响应映射为 NiceEval 助手消息或标准事件 |
| Adapter | 3 | model、选中配置与实验变量真正传到目标系统 |
| Adapter | 3 | 取消、超时、连接/协议错误不被吞掉 |
| Adapter | 2 | 凭证只存在于环境与目标服务进程边界 |
| 真实运行与公开证据 | 6 | 本轮真实非 dry Experiment 发布目标 Attempt |
| 真实运行与公开证据 | 6 | 同一 locator 的 overview/execution/source 可打开、身份一致且能交叉印证 |
| 真实运行与公开证据 | 5 | execution 确有 Adapter 映射的目标响应，不是静态 ASSISTANT 文字 |
| 真实运行与公开证据 | 3 | Attempt 是已完成的 `passed`、`failed` 或 `scored`，而非 `errored` |
| 真实运行与公开证据 | 3 | 交接引用真实 locator，且与 overview 终态一致地如实报告 |
| 真实运行与公开证据 | 1 | agent 自写 Eval 的 verdict 为 `passed`；这只是弱证据 |
| Experiment | 5 | 使用本次目标 Adapter 与目标 Eval |
| Experiment | 3 | model、flags 与静态配置有实际消费方，不是死配置 |
| Experiment | 3 | 目标服务启动、环境注入、就绪等待与清理合理 |
| Experiment | 1 | 首跑规模是一格一次 |
| Eval | 6 | 输入覆盖目标产品核心能力 |
| Eval | 6 | 断言检查业务结果，而非 succeeded、HTTP 2xx 或非空文本 |
| Eval | 4 | 真实负例能暴露关键编造/幻觉风险，prompt 不直接教标准答案 |
| Eval | 3 | 开放输出使用语义 Judge、结构解析或宽容 matcher |
| Eval | 2 | Eval 不自行启停或代管目标服务 |
| 文档与首轮理解 | 4 | 根据仓库正确识别真实接口和能力边界 |
| 文档与首轮理解 | 4 | 主动提出核心用例、可观察成功结果和主要风险 |
| 文档与首轮理解 | 3 | 询问 Tier、观测、模型和预算等真正用户选择 |
| 文档与首轮理解 | 3 | 在首轮工具证据中，先读随包 INDEX，再读具体接入页面 |
| 文档与首轮理解 | 1 | 没有退回 niceeval.com 或 GitHub `main` 的另版文档 |

DB-GPT 的高权重 Judge 要求连接仓库真实 HTTP/JSON/SSE 入口，让数据问答触达
`chat_data` / `chat_db_qa` / `chat_dashboard` 与真实数据源，并以数值、表/字段、
SQL 或查询结果断言。负例要暴露不存在表/字段被编造的风险。

GPT Researcher 的高权重 Judge 要求正确实现 FastAPI `/ws`、`start ` + JSON 与
`logs/images/report/path` 帧语义，将真实 `report` 映射为 NiceEval 输出；Eval 要检查
主题相关实质内容、结构化章节和引用 URL。负例要暴露虚构主题被伪造引用包装的风险。

## 零分 gate 与证据依赖

下列条件只决定依赖它的后续检查能否安全继续，不贡献分数：

- `niceeval.config.ts` 存在；
- 项目内 niceeval 精确解析为候选版本；
- 项目内 CLI 能发现 Eval；
- `exp --dry --json` 成功，且 `matrix.length`、`attempts`、`total`、`evals` 与
  `configs` 共同证明恰好一格一次；
- 交接明确给出的 locator 可解析；
- 该 locator 的 overview、`--execution` 与 `--source` 命令实际成功。

现有环境若缺 `NICEEVAL_INCUS_BASE_IMAGE`，dry 可能在物理 planning 阶段失败。这是应如实保留的
gate 阻塞，不得为了通过而伪造 provider 或更改运行时。

`orStop` 只放在真正存在依赖的地方。源码评分先于安装与真实证据 gate；因此运行失败
不会抹掉 Adapter 错误语义、Experiment 生命周期/预算或 Eval 用例/断言的可审查证据。
明确 stand-in 也只截断依赖真实目标执行的 published evidence；源码 rubric 仍逐项给出
可证伪诊断，其中“真实协议”自然应判为 0。

## roadmap 共享辅助

roadmap 题仍可使用 `lib/install/` 下的 `interaction.ts`、`installation.ts`、`adapter.ts`、
`experiment.ts`、`authoring.ts`、`sandbox.ts`、`quality.ts`、`documentation.ts`、`fixture.ts`
与 `archive.ts`。roadmap 题的事实仍放在 `fixtures/roadmap/<case>/case.ts`。
