# Harness 固定 Run 审计与迭代方案

审计对象：`61c4eb43-99ef-4a68-ad86-d8b98dfbd2b8`，`harness/v0.14.2`。
本轮读取已有事实，没有新增付费 coding-agent attempt，也没有重判或改写历史分数。

## 结论与证据

本 Run 为 **32/48**，但不是三题全部新执行。`regex-log` 的低分符合现有 rubric；它暴露的是
“识别环境错误后停止，没有恢复评估”的缺口。这个实验有产品回归价值，但尚不能把差异单独归因于文档。

| 题目 | Locator | 分数 | 来源与审计判断 |
| --- | --- | --- | --- |
| cancel-async-authoring | `@17DHHK1PT8CQG` | 16/16 | 本 Run 新执行；diff 只新增目标 Eval；真实 oracle、leak-probe 和 criteria fingerprint 探针形成正反验证 |
| log-summary | `@1JVT5N7KQ1FG1` | 14/14 | 沿用 Run `f468a58e-55a9-4eb9-9b4d-56369451e0fb`；执行记录正确区分 B 对 A 的答案错误与合法带引号 CSV 被 exact 断言拒绝 |
| regex-log | `@1P59ARB674QRB` | 2/18 | 本 Run 新执行；识别缺 Python，但 diff 为零，没有修复和修后复验 |

`regex-log` 的有序 execution：读取 INDEX/指南 → discovery/dry → 真跑 local → 得到
2 passed / 1 failed / 1 errored → 用固定 Run 的 show/query 核验 → 原样报告并结束。
内层 Run 是 `c92ee846-5b13-4a99-8d37-36f8b0df23e4`。

逐项 `attempt.assertion.detail` 的 contribution：依赖诊断 2/2，修复理解 0/2，配置修改 0/3，
修后公开复验 0/3，最终公开结果 0/5，最终说明 0/3。不是 Judge 把已经完成的修复误判为失败。
不过，最后一项测的是“成功修复后的报告”，不是一般的“报告是否诚实”；这次报告原始运行结果是诚实的。

审计限制：A/B 的部分 assertion material 保留不完整，不能由此推断 Judge 当时也收到截断输入。
负向工具断言 `ae_1e6d1a044150db51031e` 的公开 detail 当时连续两次读取失败；2026-10-23
通过 0.19.0 的公开 query 复查时，该 locator 返回 `inspection-selection-missing`，无法复现原错误，
因此未新建 issue，也不能判定原问题已修复。该历史读取失败不影响已读出的六项得分，
但不支持声称所有范围检查已完整审计。Show 还给这个 2/18 的 Score Eval 显示 `Verdict passed`；
不能把它解释为任务成功；同类展示问题见 [NiceEval #218](https://github.com/NiceEval/NiceEval/issues/218)（已关闭）。

复核入口：

```sh
pnpm --silent exec niceeval show --run 61c4eb43-99ef-4a68-ad86-d8b98dfbd2b8
pnpm --silent exec niceeval show @1P59ARB674QRB --execution
pnpm --silent exec niceeval show @1P59ARB674QRB --source
pnpm --silent exec niceeval show @1P59ARB674QRB --diff
pnpm --silent exec niceeval show @1JVT5N7KQ1FG1 --execution
pnpm --silent exec niceeval show @17DHHK1PT8CQG --execution
pnpm --silent exec niceeval query discover
```

## 评估本身的问题

1. **授权理解混入了产品使用能力。** “把这次评估跑完，告诉我最终结果”刻意测试自主恢复，但
   agent 也可能理解为运行一次并如实汇报。保留它作为自主性题，同时增加明确授权修复的配对题，
   例如“完成评估；若有执行错误，修复运行环境后复验，业务失败如实保留”。不要预告 Python、文件或命令。
   两题分开报告，才能区分“没有理解修复义务”和“不会使用产品修复”。
2. **方案与命令限定过窄。** 理解项接受等价 Python runtime，但配置项只认 `runtime:python` 字符串，
   复验项只认 show。若目标是任务完成，应检验真实 runtime 能力和固定结果，接受公开 query 的等价证据；
   若目标是 show 可发现性，应单列过程指标。不要用成功命令拼写代替成功行为。
3. **独立事实可更多由外层核验。** A 的终态 5 分目前让 LLM 从工具输出判断；应由外层在 agent
   结束后读取固定 inner Run、四个 slot 和来源，禁止自行重跑替 agent 补作业。Judge 只负责解释质量。
   A 的配置字符串变更也不证明实际生效。C 的真实正反运行是更好的参照。
4. **范围检查不等于总分门禁。** A 的 changedPaths、B 的 noChanges 等当前是不计分记录，不能只报
   分数便声称遵守了全部边界。分别输出分数、范围检查状态和证据可用性；不能把范围证据不可用折成零分。
5. **总分掩盖相关性与瓶颈。** A 的多个后续项都依赖“实际修复”，一次停止会连带失去大部分分数。
   18 个分值不是 18 个独立样本。应同时展示“取证、诊断、修复、复验、报告”能力分布。
6. **文档因果未隔离。** 换 npm 版本同时换 CLI、API、文档和行为，outer runner 又链接本地构建。
   应分别做产品版本回归，以及在同一兼容 runtime/API 上只替换 INIT/INDEX/相关指南的文档对照。
   每次锁定 candidate 精确版本或 tarball digest、outer 构建、模型/推理设置、fixture/rubric、endpoint 和镜像。
7. **单次样本与缓存不支持提升结论。** 三题各一个逻辑 slot，且本 Run 有一题沿用。
   32 与 32 只能说该次观察同分；canary 的 18 也必须绑定具体 Run 和同一判据才能比较。
   报告 executed/carried、origin、覆盖和失败类型；不要把沿用结果计作新增重复试验。
8. **满分没有反映使用摩擦。** B 最终归因正确，但先读了多页文档，且 `show --experiment local --all`
   被 CLI 拒绝一次。满分质量可以成立，同时应另记失败命令数、首次有效证据耗时、总耗时和用量，
   不把效率事后混进原有质量分。

三题覆盖运行修复、历史诊断和 authoring，具有明确价值。尤其 C 的官方参考实现、负例和 fingerprint
探针能抵御“只会写像样代码”的假成功。但它仍只有一类负例，后续可增加未执行判据、忽略退出码、
泄漏隐藏文件、判据变化错误沿用等独立变异，以检验评估本身是否会被错误实现骗过。

## 持续迭代规则

持续保留闭环，不启动没有停止条件的无限运行。

1. 固定当前三题为开发集，先离线修复取证缺口并校准判据。每次只提出一个可证伪假设。
   眼下优先假设是：通用文档若明确区分“执行封口”和“用户修复任务完成”，能减少 A 提前停止。
2. 先用人工已审的成功、只诊断、伪造报告、越权改判据、合法替代方案和证据缺失样本验证 scorer。
   Judge 校准可以复用这些材料；它也是模型调用，需要计费预算。证据缺失应标不可判，不能当失败。
3. 做最小配对实验：同一明确任务、同一 runtime/模型/fixture/rubric，只变更文档；
   与原先隐含任务对照。付费 attempt 数、Judge 调用和时间上限在运行前固定。
4. 开发集改善后，只对候选跑未用于改文档的保留题。变换缺失依赖、合法失败类型和输出格式，
   文档中不写本题名称、固定答案或专用 runtime tag。看过并据此调过的保留题应移入开发集。
5. 在预算允许时做多次独立尝试，顺序交错，报告逐题原始样本和不确定性。
   不复用旧 attempt 冒充独立样本；不因某一轮绿了就挑选性停止。
6. 每轮交付一个记录：假设、唯一改动、固定 Run IDs、得失、成本、是否采纳、下一问题。
   连续两轮没有预先定义的实质改善、出现保留题回归、证据不可判、infra 故障或达到预算，立即停下并归因。

本轮不更改题面或评分权重，以免把“评估变宽松”误报成候选进步。基础设施变更另行验证后，
再按上述顺序推进下一轮。
