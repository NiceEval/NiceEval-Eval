# 2026-11-21 Harness 三版本全量与 DB-GPT 补跑

本轮按 HEAD `8cce826` 的题目，在 `0.19.0`、`0.20.0`、`0.21.0` 三个正式版上重跑 Harness 全部 24 题，共 72 格，另补跑 `install/v0.21.0 × db-gpt` 一格。被测 agent 仍是 `gpt-6.1-sol`、medium、每格 1 个 Attempt。

结果：Harness 72 格 **70 passed、2 failed、0 errored**（含一格补跑）；DB-GPT v0.21.0 **passed，95/100**，此前四次真实运行都是 errored。

## 为什么全量重跑

11-17 那批 medium 结果之后，24 题中有 21 题的 `eval.ts` 改过：单轮题去掉了模拟用户兜底，评审者换成 `evals/judges/` 的共享定义，concord-rsi 重写，另新增 `organize-refund`。旧分数测的不是当前这套题，所以三版全部按当前题目重跑，不是为了数据纯净而重跑。

同时，评估内部模型统一换成 `gpt-6.2-sol`（`a27039e`）：Judge、Agent Judge、模拟用户，以及目标应用和 concord-rsi 内层（原为 `gpt-6-astra` 与 `deepseek-v4.1-flash`）。被测 agent 不变。concord-rsi 在新内层模型下复测过起点（`8cce826`）：原始状态 4/16、控制题 4/4，外层起点门槛仍成立；修好第 1 层后，工具层把失败当成功的缺陷仍挡住修复类题目。

宿主 NiceEval 使用本机源码构建的 dist。Harness 批次运行在 `f631adbf9`，两格补跑运行在 `70150e781`（含 Agent Judge 审计脱敏与结构化重试修复）。

## Harness 分数

Invocation `s_2605552a-4214-47e1-902e-6cfa163bfdee`，Run `0b289e05`（v0.19.0）、`6cba5853`（v0.20.0）、`068110ef`（v0.21.0）。

| 条件 | v0.19.0 | v0.20.0 | v0.21.0 |
| --- | --- | --- | --- |
| errored-triage | 14/16 | 16/16 | 16/16 |
| flaky-check | 13/14 | 12/14 | 13/14 |
| multiturn-authoring | 25/27 | 25/27 | 25/27 |
| organize-refund | 8/14（failed） | 14/14 | 14/14 |
| regression-triage | 17/17 | 17/17 | 17/17 |
| rerun-scope | 17/17 | 17/17 | 17/17 |
| terminal-bench/cancel-async-authoring | 22/22 | 21/22 | 22/22 |
| terminal-bench/classifier-pressure | 15/15 | 15/15 | 15/15 |
| terminal-bench/log-summary | 12/14 | 14/14 | 14/14 |
| terminal-bench/log-summary-repair | 22/23 | 21/23 | 21/23 |
| terminal-bench/regex-log | 8/10 | 8/10 | 10/10 |
| terminal-bench/regex-log-authorized | 8/10 | 10/10 | 8/10 |
| tool-guard | 25/28 | 25/28 | 28/28 |
| trace/author-hitl-cancel | 27/30 | 27/30 | 27/30 |
| trace/fix-flaky-eval | 21/24 | 21/24 | 21/24 |
| trace/trace-flaky-cause | 16/16 | 16/16 | 14/16 |
| trace/trace-order-swap | 16/16 | 16/16 | 16/16 |
| trace/trace-slow-assertion | 16/16 | 16/16 | 16/16 |
| trace/trace-slow-turn | 15/17 | 15/17 | 17/17 |
| trace/trace-swallowed-error | 16/16 | 16/16 | 16/16 |
| trace/trace-token-spike | 17/17 | 11/17 | 17/17 |
| trace/trace-wrong-argument | 12/15 | 12/15 | 12/15 |
| trace/triage-at-scale | 19/30 | 25/30 | 21/30 |
| **23 题合计** | **381/424** | **390/424** | **397/424** |
| trace/concord-rsi（另计） | failed，零分门槛 `@19JQHV6SS1P9G` | 33/42 | 34/42 |

concord-rsi 单独列出：v0.19.0 首跑 `@1RAPYNHEY5KWM` 因 3 次 Agent Judge 调用被网关以账号并发上限拒绝而 errored（33/42 为部分分），修复后补跑一次。补跑中 agent 在 `evals/verification/` 新建了两个 eval，触发"现有受保护文件保持原样，仅允许新增实验"门槛后停止。题面原文是"现有评估和实验不能动；需要局部测量可以自己加实验"，没有明说能否新增评估文件，判据比题面严。v0.20.0、v0.21.0 的 agent 只新增实验，这条都过了。是否放宽这条门槛属于题目设计决定，本轮未改。

### 分差在哪

三个版本之间的分差分散在十几个判据上，没有一题稳定偏向某个版本，每格又只有 1 个 Attempt，所以不能把这些差异归因到版本。较大的几处：

- `organize-refund` v0.19.0：整理期间产生了新执行，没有保留第一轮的 failed Attempt（0/2、0/4 两条），整格 failed。
- `trace-token-spike` v0.20.0：没有指出 `topK` 改为 `all`，也没有引用可复查证据（丢 6 分）。
- `triage-at-scale`：v0.19.0 与 v0.21.0 都把中文请求改用英文这条误判，并把两条 catalog 老问题当成新问题；v0.21.0 正确合并了两条金额失败的根因。
- `tool-guard` v0.21.0 拿到"靠文档、类型声明与 --help 完成"的 3 分，前两个版本没有。

和 11-17 一样，三个版本对 `gpt-6.1-sol` 都基本够用，Harness 仍接近饱和。

## DB-GPT v0.21.0

补跑 `@1RJ75HMDP3YHP`：passed，95/100，分数 complete。前一次（本轮 `@1BEAW49TGXMJ9`）errored，两个根因都在 NiceEval，已修复：

- 5 条 Agent Judge 审计无效：`6fe3aeed9` 只对 pi session 里的凭据做了脱敏，独立记录的 `tool.arguments` 保留原文，严格关联校验失败（`4dfa580ee`）。
- 10 次 Agent Judge 调用被网关返回 `Concurrency limit exceeded for account`。pi 只按错误文本判断是否重试，这句不命中。现在 managed pi 在 Provider 层按 HTTP 状态最多重试 2 次，并遵守 Retry-After（`0dfb34bf2`）。补跑时网关没有再限流，新重试逻辑尚未在真实网关上被触发过。

## 本轮修复的 NiceEval 问题

| 提交 | 问题 |
| --- | --- |
| `f631adbf9`、`14ccb03d2` | 多 Run 的 `show exp:` 与 72 格 `exp` 启动因只读会话超时失败。单实验 `show exp:` 从 25 秒降到约 2.4 秒（CLI 进程），三实验从 43 秒降到 4.9 秒 |
| `4dfa580ee` | Agent Judge 审计脱敏导致关联校验失败；`show` 现在会显示审计无效与 Judge 调用失败的具体原因 |
| `0dfb34bf2` | managed pi 对网关限流不重试 |
| `ad9269d12` | 长会话的遥测收集超过 30 秒预算；88 MB OTLP 由超时降到 10.7 秒，不完整时公开说明收集范围 |
| `8ffee0c32`、`d44d3a0d7` | 新增 Antigravity CLI（agy）适配器，供之后评测 Google 模型 |

## 已知缺口与未完成

- `equals` 门槛失败时，Record 只存 `equals-mismatch`，`show` 看不到实际值（例如 concord-rsi 是哪些受保护文件被改了），只能借 `diff` 切片推断。核心已有本地 Issue `check-actual-value-hidden` 记录同一缺口，本轮 `@19JQHV6SS1P9G` 是新的复现。
- 收尾 Agent Judge 是最长的非 agent 阶段：DB-GPT 505 秒，其中一个会话串行处理 6 条判据用了 500 秒。拆分并发会话的改动正在进行。
- DB-GPT 的 `workspace.baseline` 有一条 21.5 秒的 `rm`；Agent Judge 的每次 `judge.request` 都被标为 failed，疑似误标。两项正在核心修复。
- README 的 Harness 题表仍是 20 个条件、340 分，缺 `organize-refund`、`triage-at-scale`、`author-hitl-cancel`、`fix-flaky-eval`、`concord-rsi`。
- 估算费用约 $14.8（Harness 72 格，不含 Judge）；`gpt-6.2-sol` 未配置价格，Judge 费用不可用。
