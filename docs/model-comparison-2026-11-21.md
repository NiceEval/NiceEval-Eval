# 2026-11-21 被测模型对比：gpt-6.2-sol 与 gpt-6.1-sol

候选固定为 NiceEval `0.21.0`，比较 `harness/v0.21.0`（被测 gpt-6.1-sol）与 `harness/v0.21.0-gpt-6.2-sol`、`install/v0.21.0` 与 `install/v0.21.0-gpt-6.2-sol`。Judge、Agent Judge 与模拟用户都用 gpt-6.2-sol；安装题的目标应用用 DeepSeek 中转；concord-rsi 内层另配，见下文。

**结论：在这套题上，gpt-6.2-sol 没有比 gpt-6.1-sol 更好。** 安装题上 6.2 稳定更弱，主要失败方式是把评估对象理解错、没能让目标应用返回真实响应；Harness 上两者接近，只有大规模分诊这一题 6.2 稳定更好。

## 判据先修过

第一轮对比后做了判据审计（[rubric-revision-2026-11-21](rubric-revision-2026-11-21.md)）：9 条可疑判据里 6 条本身有问题，例如同一种写法被 Judge 前后判出相反结果、把合法的实现选择当对错、要求 agent 为上游项目的日志行为负责。修订后又发现两处让任务不可完成的模拟用户画像：llm-x 的画像没有授权真实调用，模拟用户因此拒绝了 agent 的调用预算；concord 的画像没回答能否用 Node 运行 NiceEval。另外 install/concord 原先缺 HawDB 原生库，基线检查在环境里就失败。下面的数字全部来自修订之后。修订前的分数口径不同，不能与之相减。

## 安装题（每格 2 次）

| 题目 | gpt-6.1-sol | gpt-6.2-sol |
| --- | --- | --- |
| db-gpt（满分 100） | 91、93 | 82、77 |
| gpt-researcher（满分 100） | 77、75 | 70、77 |
| llm-x（满分 61） | 37 passed；5/37 failed（没真实运行自己的 Experiment） | 18 failed；18 failed（应用都没返回真实响应） |
| concord（满分 34） | 14 failed；5 errored（3 条 Agent Judge 超时，判据会话已拆分） | 3 failed；2 failed |

concord 上 6.2 两次都自写 `defineAgent` 去包装 Concord CLI，把工具当成被测对象；用户要的是“获随包指引的 Codex 与未获指引的 Codex”对比。0.21.0 的 INIT 还没有“宿主只给 coding agent 提供指引时，被测对象是 coding agent”这条路由，main 已补上；同时 INIT 现在要求即使为别的阻塞问题停下，也要附上计划与被测对象（核心提交 `a335bef96`，Issue `init-confirm-target`）。

## Harness（修订后判据，每格 2 次）

| 题目 | 满分 | gpt-6.1-sol | gpt-6.2-sol |
| --- | --- | --- | --- |
| multiturn-authoring | 27 | 25、25 | 25、25 |
| trace/author-hitl-cancel | 30 | 25、25 | 26、23 |
| trace/fix-flaky-eval | 24 | 23、23 | 23、23 |
| trace/trace-wrong-argument | 15 | 12、12 | 10、12 |
| trace/triage-at-scale | 30 | 17、19 | 27、22 |
| 合计（均值） | 126 | 103 | 108 |

triage-at-scale 是唯一稳定拉开差距的题：连同修订前的三次，6.2 五次为 25、27、28、27、22，6.1 为 30、21、17、17、19。trace-wrong-argument 的“误取第一条”两边都没拿到，确实难，保留。

## concord-rsi

| 内层模型 | gpt-6.1-sol | gpt-6.2-sol |
| --- | --- | --- |
| gpt-6.2-sol | 39、39 | 39、39 |
| gpt-6-luna | 39.5、39 | failed（改了受保护的 `agents/doc-assistant.ts`）、39 |

共享 DeepSeek 中转并发 2 即 429、并发 4 即 503，起点测量会失败，所以 concord-rsi 内层改走 Codex 网关（`CONCORD_RSI_*`）。换成较弱的 gpt-6-luna 后分层校准恢复（4/16→4/8→5/8），但外层得分仍在 39/42 附近封顶：隐藏集提升与根因修复两个模型都轻松拿满，这道题当前只能区分“守不守规则”。需要从计分结构重新设计，不是只换内层模型。

## 成本与环境说明

- 网关后台显示当日 Codex key 计费约 $73。被测 agent 的缓存命中约 90–97%，网关的提示缓存实测正常；普通 Judge 原先命中为 0（同时并发发出、材料顺序不稳），核心已改为材料在前并带稳定缓存键。目标应用曾短暂切到 Codex key，现已切回 DeepSeek。
- 模拟用户曾把真实 API key 原文写进 Record。核心新增 `t.sensitiveValues`，内置适配器也会登记自己注入的凭据；llm-x 已登记连接凭据，复查新记录中原文 0 处、`<redacted>` 7 处。泄露过的 key 建议轮换。

## 仍未解决

- concord-rsi 计分结构需要重设计，当前不适合用来比较模型。
- 长会话的遥测收集仍偶尔超过 30 秒预算，现在会如实标注采集不完整。
- 每格只有 2 次采样；db-gpt 与 llm-x 的差距方向一致，gpt-researcher 与 concord 的差异不宜过度解读。
