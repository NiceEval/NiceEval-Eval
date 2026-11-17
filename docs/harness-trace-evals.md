# Harness 追踪诊断题（2026-11-17）

## 为什么加

2026-11-17 的 Harness 重跑在 medium 与 low 两档推理下都饱和：三个候选得分率 91–97%，单题差异只有 ±2 分且随样本换位，比不出版本。现有题大多能从 verdict、断言文字或回复文本直接读出答案。

新增四道只读诊断题，答案**只在 trace 里**：工具调用的参数与输出、逐轮耗时、逐轮 token 用量、多轮会话中间某一轮的工具结果。最终回复、断言标签与 verdict 都不足以作答，agent 必须用这个版本的公开 CLI（`show` 的 execution / timing / usage 或 `query`）找到证据。不同版本呈现 trace 的能力不同，这正是要测的版本差异。

## 共同骨架

照抄 `evals/harness/regression-triage/eval.ts`：

- 起始项目在 `fixtures/harness/<题名>/repo/`：一个 canned agent（`defineAgent`，按输入前缀返回预设 `events` / `usage`，可在 `send` 里真实 sleep）、若干 Eval、一个或两个 Experiment、`niceeval.config.ts`、`README.md`。
- 外层先 `exp` 跑出起点并核对起始 verdict 与题目设定一致，不一致就抛错、不判分。
- 题面用真实用户口吻，只问结论，**不提示**该看 execution、timing 还是 usage，也不提示答案方向；明确“结果已留档，不要重跑、不要改文件”。
- HITL：首轮后只为原生 waiting 提问续答，最多 6 次（与 regression-triage 相同）。
- 通用判据：`readsPrivateRecord` 未调用（gate，非完整审计）、没有新发布的 Run（2 分）、项目文件不变（1 分）。
- 事实判据用 `binaryJudge`，rubric 先写出隐藏事实，再问最终回复是否说中；只说“断言失败 / 回复不符合预期”这类泛话不给分。
- 每道题另有 1 条“引用了公开证据”判据（2 分）：回复是否给出能复查的 locator 或公开 `show` / `query` 命令。

## 四道题

### `trace-wrong-argument`（工具参数，15 分）

- **场景**：客服助手，Experiment `local`，3 条 Eval。`support/cancel-order` failed，另两条 passed。
- **隐藏事实**：用户要取消 A-1002。助手先调用 `lookup_orders`，返回两个订单 `[A-1001（已送达，较早）, A-1002（待发货）]`；随后调用 `cancel_order`，参数却是 `{"orderId":"A-1001"}`。最终回复写的是“已为您取消订单 A-1002”。断言检查 `cancel_order` 的参数等于 A-1002，所以 failed。
- **题面**：“cancel-order 这条挂了，可助手回复明明说取消了 A-1002，是不是判据写错了？结果已留档，别重跑，也别改文件。”
- **判据**：结论是判据没错、助手真的取消错了（4）；指出实际取消的是 A-1001（3）；原因是 lookup 返回两个订单、助手取了第一个（3）；引用公开证据（2）；通用 3 分。

### `trace-slow-turn`（逐轮耗时，17 分）

- **场景**：订房助手，Experiment `local`，4 条 Eval 全部 passed。其中多轮 Eval `booking/three-step` 有 3 个 Turn，耗时约 80 秒；其它 Eval 约 1 秒。
- **隐藏事实**：慢在第 2 个 Turn（约 75 秒）。这一轮里 `search_hotels` 被调用 3 次：前两次输出 `{"error":"rate_limited","retryAfterSeconds":30}`，第三次成功。canned agent 在这一轮真实 sleep 约 75 秒。第 1、3 轮与断言评估都很快。
- **题面**：“booking/three-step 每次都要一分多钟，别的都是一秒，慢在哪？结果已留档，别重跑。”
- **判据**：定位到第 2 轮（4）；指出是 `search_hotels` 被限流后重试了两次（4）；排除 Judge、Sandbox 与模型推理为主因（2）；给出大致量级（这一轮约占 75 / 80 秒）（2）；引用公开证据（2）；通用 3 分。

### `trace-token-spike`（逐轮用量，17 分）

- **场景**：知识库助手，Experiment `baseline` 与 `candidate`，同样 6 条 Eval，两边 verdict 完全相同（全部 passed）。
- **隐藏事实**：candidate 里 3 条 `kb/*` Eval 的 Turn 输入 token 从约 2,000 涨到约 50,000，其它 3 条不变。原因在工具调用：candidate 调用 `search_kb` 时参数是 `{"query":…,"topK":"all"}`，输出包含整个知识库（几十 KB 文本）；baseline 是 `topK: 3`。canned agent 用 `Turn.usage` 报告各轮 token。
- **题面**：“换了新提示词以后结果都一样，但账单涨了好几倍，钱花在哪了？结果已留档，别重跑。”
- **判据**：指出涨幅集中在 3 条 `kb/*`（4）；指出机制是 `search_kb` 的 `topK` 变成 `all`、把整个知识库塞进上下文（4）；给出量级（约 2k → 50k 输入 token）（3）；说明 verdict 没变（1）；引用公开证据（2）；通用 3 分。

### `trace-swallowed-error`（多轮中间的工具结果，16 分）

- **场景**：电商结账助手，Experiment `local`，3 条 Eval。多轮 Eval `checkout/pay` failed（3 个 Turn），另两条 passed。
- **隐藏事实**：第 2 轮 `charge_card` 的输出是 `{"error":"card_declined","code":"insufficient_funds"}`，但助手第 2 轮和第 3 轮的回复都说“支付成功，订单已确认”。断言检查订单状态 `paid`，实际 `pending_payment`，所以 failed。这不是环境故障，也不是判据过严。
- **题面**：“checkout/pay 挂了，助手明明说支付成功了，是不是测试环境的支付服务有问题？结果已留档，别重跑，也别改文件。”
- **判据**：结论是助手问题，不是环境或判据（4）；指出第 2 轮扣款被拒（`card_declined` / 余额不足）（4）；指出助手无视工具错误、谎报成功（3）；引用公开证据（2）；通用 3 分。

## 接入与验收

- 四题放在 `evals/harness/trace/<题名>/eval.ts`，tags 带 `harness`、`harness-v2`、`trace`、`diagnosis`；Harness 三个候选 Experiment 的 `evals: ["harness/"]` 自动包含。
- `evals/harness/README.md` 的条件表与满分合计、根 `README.md` 的 Harness 题数同步更新。
- 实现者验证：每题的 canned agent 与起点在本地跑一次 `exp`，核对起始 verdict；外层 eval 用 `niceeval exp harness/v0.21.0 harness/trace/<题名> --dry` 检查可加载。真实付费运行由父 agent 统一跑。
- 验收：三个候选各跑一次四题。期望它们不再全满分；若四题在三个候选上仍都 ≥95%，记为饱和并继续加难度。

## 第二轮：更难的追踪题（2026-11-17）

第一轮四题跑完：三个候选 60/65、60/65、58/65，丢分位置几乎相同，仍接近饱和。原因是每题的答案都在一个 Attempt 的一处 trace 里，找到就能答。第二轮三题要求**跨 Attempt 比对**，并放入**看起来可疑但无关的干扰项**；其中一题的证据只在较细的 timing 呈现里，用来拉开版本差异。共同骨架与判分写法沿用上文，满分各 16，三题合计 48。

### `trace-order-swap`（跨实验比对工具顺序，16 分）

- **场景**：退款助手，Experiment `baseline` 与 `candidate`，各 4 条 Eval。candidate 的 `support/refund-request` failed，其余与 baseline 相同。
- **隐藏事实**：两个实验在 refund-request 上的最终回复一字不差，调用的工具集合也相同（`verify_identity`、`refund_payment`），但 candidate 先调用 `refund_payment` 再调用 `verify_identity`。断言要求先核验身份再退款，所以 failed。这是确定性的行为差异，不是 flaky。
- **干扰项**：candidate 的另一条 passed Eval `support/order-status` 带一条 `telemetry-budget-exceeded` warning；与失败无关。
- **题面**：“candidate 里 refund-request 挂了，可回复跟 baseline 一字不差，是不是 flaky？结果已留档，别重跑，也别改文件。”
- **判据**：结论是确定性行为差异、不是 flaky（3）；指出工具调用顺序反了：先退款后核验（5）；说明回复文本相同、只比回复看不出（2）；没有把 order-status 的 warning 当作原因（1）；引用公开证据（2）；通用 3 分。

### `trace-flaky-cause`（同一 Run 多次 Attempt 比对，16 分）

- **场景**：天气助手，Experiment `local` 设 `attempts: 4`、`earlyExit: false`，Eval `weather/umbrella` 2 passed、2 failed；另两条 Eval 全部 passed。
- **隐藏事实**：canned agent 按 attempt 序号决定 `get_forecast` 的输出：第 2、4 次返回 `{"cached":true,"ageSeconds":7200,"rainChance":0.1}`（两小时前的缓存），第 1、3 次返回 `{"cached":false,"rainChance":0.8}`。助手据此回答“不用带伞”或“记得带伞”；断言要求“带伞”。失败与缓存的旧数据严格对应，不是模型随机。
- **干扰项**：失败的两次耗时略长（多 sleep 1–2 秒），看起来像超时相关，实际无关。
- **题面**：“weather/umbrella 有时过有时不过，是模型随机性还是有确定原因？要不要加重试？结果已留档，别重跑。”
- **判据**：结论是确定原因而不是随机（3）；指出失败的两次 `get_forecast` 拿到了两小时前的缓存数据（5）；指出 passed 与 failed 的差别在工具输出、不在回复风格或耗时（2）；建议修数据源或缓存而不是加重试（1）；引用公开证据（2）；通用 3 分。

### `trace-slow-assertion`（耗时在判分而不在 agent，16 分）

- **场景**：文档助手，Experiment `local`，3 条 Eval 全部 passed。`docs/citations` 每次约 100 秒，其余约 1 秒。
- **隐藏事实**：agent 的 Turn 不到 2 秒。时间花在断言阶段：这条 Eval 有一条自定义检查“引用链接都可访问”，对 20 个链接逐个串行检查、每个等待约 5 秒（fixture 内实现为可控的 sleep，不访问外网）。其余断言都是毫秒级。
- **干扰项**：agent 的 Turn 里有一次 `search_docs` 工具调用输出很长；与耗时无关。
- **题面**：“docs/citations 每次要一分多钟，agent 两秒就答完了，时间去哪了？结果已留档，别重跑。”
- **判据**：定位到断言阶段而不是 agent、Sandbox 或 Judge（4）；指出是“引用链接都可访问”这一条检查（4）；指出逐个串行、每个约 5 秒、20 个约 100 秒（2）；没有把长工具输出当作原因（1）；引用公开证据（2）；通用 3 分。

验收同第一轮：三个候选各跑一次三题；若仍都 ≥95%，继续加难度。
