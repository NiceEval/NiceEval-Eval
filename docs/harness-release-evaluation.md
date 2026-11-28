# 发版评估协议

本协议覆盖 `harnessRubric: v2` 的 Harness 题库与安装题的运行规划、付费运行和报告。
批次的实际结果写入带日期的验收记录。

## 固定比较对象

产品版本回归：旧发布包与新发布包都用同一份 v2 题库、Judge/模型/推理设置、镜像和外层构建。
它回答完整产品使用表现是否改善，不能归因到单独的 INDEX 或 INIT。
文档对照：另固定兼容的 CLI/API/runtime，只替换完整文档快照（INDEX、相关指南、init 托管
指引；安装题另含 INIT），并让快照摘要进入身份。当前候选安装器仍只按 npm 版本选择包，
**尚不支持独立文档覆盖**；不要把完整版本对比叫作文档因果实验。

每个批次记录 NiceEval-Eval commit、外层 NiceEval 构建/包摘要、候选精确版本与包摘要、
模型/推理设置、Judge 配置、基础镜像和 inner runtime digest、fixture/rubric 版本、并发、
非秘密 endpoint 标识、预算和停止条件。不记录凭据。只改其中一个因素才能归因到该因素。

## 选择运行范围

从仓库根目录设置本项目的 NiceEval home，再运行对应的预览。`total` 是本次选择的计划格数，`reused` 是其中可沿用结果的格数。
无人值守和后台运行都显式传 `--no-pause`。 [后台运行说明](install-autonomous-runs.md#后台运行时关闭失败挂起)

```sh
export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"
```

### 日常 Harness 初筛

一般 Harness 变更先看这六格。`organize-refund` 检查题目整理与结果沿用，`triage-at-scale` 检查批量分诊，
`tool-guard` 检查工具调用边界，`trace-token-spike` 检查能否用记录解释用量暴涨。两道 `regex-log` 共用 fixture，
检查自主处理执行错误和用户明确授权修复时的行为，须成对解读。涉及安装、重试等特定功能时，直接选对应题。
初筛和正式矩阵的题目覆盖与分母不同，初筛总分不得与正式矩阵总分直接比较。

```sh
pnpm --silent exec niceeval exp harness/canary \
  harness/organize-refund harness/trace/triage-at-scale \
  harness/tool-guard harness/trace/trace-token-spike \
  harness/terminal-bench/regex-log harness/terminal-bench/regex-log-authorized \
  --no-pause --dry --json
```

### 安装有效题

用四道有效题检验候选的从零接入流程。定向检查宿主时只选对应题。
`install/comfyui` 等占位题仅保留在开发清单，日常和发版运行均排除。

```sh
pnpm --silent exec niceeval exp install/canary \
  install/db-gpt install/gpt-researcher install/concord install/llm-x \
  --no-pause --dry --json
```

### 正式发版矩阵

默认比较 `v0.19.0`、`v0.20.0` 和实际解析出的 canary。两族使用相同候选，每题设 1 个 Attempt。
`harness/` 选择完整 Harness，包含 `harness/errored-triage` 保留题。Install 用四个显式选择器。
比较三个固定发布版本时，可将两处 `canary` 改为 `v0.21.0` 后重新预览。

```sh
pnpm --silent exec niceeval exp \
  --experiment harness/v0.19.0 --experiment harness/v0.20.0 --experiment harness/canary \
  --experiment install/v0.19.0 --experiment install/v0.20.0 --experiment install/canary \
  harness/ install/db-gpt install/gpt-researcher install/concord install/llm-x \
  --no-pause --dry --json
```

2026-11-27 用上面三条命令得到以下预览。运行前以当次 `total` 和 `reused` 为准。
Judge、Agent Judge 和内层运行成本另计。

| 预览 | `total` | `reused` |
| --- | ---: | ---: |
| 日常 Harness 初筛 | 6 | 0 |
| 安装有效题 | 4 | 0 |
| 正式发版矩阵 | 84（每个候选 24 道 Harness 和 4 道 Install） | 0 |

同日用 `pnpm --silent exec niceeval exp --no-pause --dry --json` 盘点仓库全部可发现的计划，得到 `total=145`、`reused=0`。
盘点包含模型对照和占位题。发版以带选择器的命令为准。

## 运行顺序

1. 完成 VM 内真实请求的网关预检；宿主 443/401 和 dry-run 不能替代 VM 的真实模型请求。
2. 确认精确候选、运行范围与成本授权。先跑 `typecheck` 和对应范围的 `--dry --json`，检查计划格数和沿用数量。
3. 在同一 Invocation 内选择多个候选，共用全局并发上限 10，使用独立 Sandbox；关闭首过即停。要求新增独立样本时用
   `--rerun all`，不得沿用旧 Attempt 充数。保留完整 created Run IDs。
4. 运行中定期用 `niceeval invocation show <id> --json` 对照阶段与实例，并只读进入 Sandbox 看进程、工作区与准备结果。
   不在被测环境写文件、杀进程或改配置。发现会让结果作废的基础设施缺陷时及时停止，保留已完成结果。
5. 对明确 Run 用 `pnpm exec niceeval view run:<baseline-run-id> run:<candidate-run-id>` 并排审阅，
   脚本化比较用 `niceeval compare run:<baseline-run-id> -- run:<candidate-run-id> --json`。
   用 `show @<locator>` 找断言，再用 `show @<locator> assertions <entry-id> --json` 读取实际判定。
   逐项审阅 README 列出的范围与完成事实；沿用（carried）与采用（accepted）的结果不算新样本。
6. 开发集有效改善后，用 `harness/errored-triage` 单独检查保留题。在正式报告中单列保留题结果。

需要重跑的命令必须先以 dry 形式验证，再在用户明确预算内移除 `--dry`。不要自动启动
整个 `harness` 矩阵，也不要把旧判据结果 adopt 到新判据。局部补跑必须用精确 Eval 选择器，
全量重跑只有在用户明确授权后执行。旧格式 Record 被拒绝时保留或归档原文件，不自动迁移或清空。

## 如何说提高了多少

比较先给分数：每个族报告各候选的总分与得分率，以及逐题分数表；verdict、通过率与 gate 失败列在分数之后，用来解释分数而不是代替分数。install 与 harness 同样适用。

**饱和规则。** 某族所有候选的得分率都不低于 95%、且逐题差异不超过 2 分时，该族记为“饱和”，报告中写明，不用来给候选排序；需要区分度时出更难的题；被测 agent 固定 gpt-6.1-sol medium，不降模型或推理档位，也不靠加样本硬比。

逐题报告正式矩阵所选的条件和分母。同 fixture 的条件按家族关联解释。
对固定题面与同一评分规则，报告完成率差值（候选减基线，单位百分点）、逐题分数变化、
基线失败→候选成功及基线成功→候选失败的数量。完成率必须结合不计分的边界事实，不能用
`scored` 或最高总分直接生成。

沿用、采用、重复 Attempt ID 不算新增样本。报告所有计划位置以及新执行、沿用、errored、
不可判和预算未派发数量；给有效样本分母，同时展示未覆盖比例，不静默丢弃故障批次。
成本/耗时在完成质量相当时比较；缺少 cost/usage 时写 unavailable，不补零。

重复样本报告原始次数和不确定性。若做区间估计，按任务家族聚类，以免把同一题的多项判据当成独立样本。
保留全部重复结果。
旧 Run 的 32/48 只保留为历史审计，新规则分数不能与它直接相减。

固定批次跑完再判断，不因某次全绿选择性提前停止。基础设施故障、不可判、保留题回归或
预算用尽时暂停并归因；连续两轮未达到预先写明的实质改善门槛则停止调优。
门槛与预算必须在看候选结果前指定，不事后按观察结果调整。
