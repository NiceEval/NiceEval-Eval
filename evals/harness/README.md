# Harness 评估套件

这组题评估 coding agent 能否在一个已经接入 NiceEval 的项目里，自主完成“运行 → 用公开
`niceeval show` 取证 → 形成因果判断 → 在正确层修改/给出归因”，以及能否把真实题包写成
不泄漏判据的 Eval。三题共享运行基建，但各自维护独立项目与独立起始状态；完整矩阵为
1 个当前 canary × 3 题 × 1 次，共 **3 个付费
coding-agent attempt**。

## 当前三题

| 用例 | 用户交互 | 初始状态 | 主要能力 |
| --- | --- | --- | --- |
| `terminal-bench/regex-log` | 单轮：把评估跑完并报告最终结果，题面不预告 error | 真实 TB task slice 首跑 2 passed / 1 合法 failed / 1 缺 Python errored | 自主识别未完成的 errored、定位 experiment runtime 缺口、最小修改恢复、按候选版本差异复验 |
| `terminal-bench/log-summary` | fixture 先运行；单轮追问每个失败，未授权修改 | 真实 TB task slice 已有 1 passed / 2 failed / 0 errored | 直接用 `show` 进入反馈闭环，区分「agent 产出错误」与「eval 过紧」 |
| `terminal-bench/cancel-async-authoring` | 单轮：把未接入的真实题包写成正式 Eval | 官方题面、Docker fixture、隐藏测试、离线 runner 与两格确定性 agent 已就绪 | 正确使用任务级 sandbox、隐藏判据时序、criteria fingerprint，并用 oracle / leak-probe 证明正反边界 |

## 真实题意

### A · terminal-bench/regex-log

用户只要求“把这次评估跑完”，题面刻意不预告 error、根因、修复文件或候选版本策略。
这里测的正是 agent 能否识别 `errored` 表示评估尚未跑完，自主诊断并修复基础设施；
已完成的合法 `failed` 则是应被如实保留的业务结论，不等于“没跑完”。

候选 workspace 里的 inner project 从 `NiceEval/terminal-bench` 的已审核题包裁出四项：
`hello-world`、`fix-permissions`、`classifier-debug` 和 `regex-log`。首跑 `niceeval exp local`
得到 **2 passed / 1 合法 failed / 1 errored**：`classifier-debug` 的 canned agent 选择错误的 B，
是可信 failed；`regex-log` 直接运行 TB 官方 Python 判据，而当前 runtime 镜像没有 python3，因而 errored。

完整且**唯一**的正确修复是只把 `experiments/local.ts` 里的
`runtime:node` 改成 `runtime:python`，其余一律不动。修复后复验：

- 候选为 0.14 API / canary 时，从公开 `niceeval show` 输出动态取得 locator，恰好 accept
  三条仍有效的 terminal results（`hello-world`、`fix-permissions`、`classifier-debug`），只真实
  重跑被改动影响的 `regex-log`；

候选的正确终态是 **3 passed / 1 failed / 0 errored**——合法 failed 的那道不因换运行时
而改变，它本来就不是环境问题。题目考察的是 agent 能否从 CLI 反馈把「errored 的环境缺口」
与「failed 的业务事实」分开，而不是让它把所有红灯都“修绿”。

### B · terminal-bench/log-summary

fixture 先替用户运行评估，随后用户只追问每个失败的原因，没有授权重跑或修改项目文件。
这里测的是 agent 能否直接从 `niceeval show` 进入已经停稳的 Record，把已完成的 `failed`
当作需要归因的结果，而不是先重学 CLI、重跑 experiment，或把红灯“修绿”。

inner project 首跑 **1 passed / 2 failed / 0 errored**。agent 的任务是逐道给出因果归因并
如实交接，**不得修改任何 eval 或项目文件**：

- `terminal-bench/classifier-debug`：正确选项与断言要求都是 A，canned agent 却写入 B。这是
  **agent 产出/能力问题**，断言本身是对的；
- `terminal-bench/log-summary`：ERROR/WARNING/INFO 计数是正确的 4/3/8，输出也是合法 CSV，
  只是字段带标准双引号。TB 官方 CSV 判据会接受，本地 exact 字符串断言却拒绝——这是
  **eval 过紧**。

正确完成 = 两道失败都归因到正确层、不产生任何文件改动；错误完成 = 靠改断言、放宽匹配或
改 fixture 让套件变绿，或把两类失败互相张冠李戴。

### C · terminal-bench/cancel-async-authoring

用户给出 `terminal-bench@5964952` 的真实 `cancel-async-tasks` 题包，要求 coding agent 只创建
`evals/terminal-bench/cancel-async-tasks.eval.ts`。官方题意是实现受最大并发数约束、在
KeyboardInterrupt 时仍运行 cleanup 的 Python async task runner；六个官方测试覆盖文件存在、
并行执行、并发上限，以及低于、等于、高于上限时的取消清理。

这题不按源码模板或回复措辞判分。外层真实运行两个确定性 experiment：oracle 在 task agent
turn 内写入官方参考实现，必须得到 **1 passed / 0 failed / 0 errored**；leak-probe 会先检查
agent 可见文件系统，若提前看到 tests、runner 或 solution 就写入参考实现，否则写入违反并发要求
的负例。因此正确 Eval 下它必须得到 **0 passed / 1 failed / 0 errored**，而不是 errored。
隐藏材料进入 Docker build context、在 `t.send()` 前上传，或 verifier 没有真正执行官方 tests，
都会让负向探针意外通过。

外层还会给官方测试追加一行不改变行为的注释后再次运行 oracle。只有 Eval 在发现期把隐藏测试
及 runner 登记进 criteria fingerprint，第二次才会自动重跑并公开报告 0 reused；这避免“本次恰好
跑通，但以后修改判据仍错误复用旧结论”的假完成。

## 共享基建，独立 repo

Node、pnpm、Docker/Compose、项目 seed 与两枚**完全离线**的 inner runtime 归档（node / python
变体）由通用 Harness 镜像共享。Experiment 的 TS layer 先导入并冒烟离线 runtime，再按解析后的
精确版本安装候选 NiceEval、运行 `niceeval init`、清理示例并物化只读依赖树；随后各题 fixture
才覆盖自己的 repo。完整顺序见 [`fixtures/harness/README.md`](../../fixtures/harness/README.md)。
当前 Harness canary experiment 沿用项目的全局并发设置；单个 Attempt 已同时占用候选
Sandbox 与内层 dockerd，运行时需留意宿主资源竞争和模型网关并发抖动。

`fixtures/harness/<case>/repo/` 由每道题各自维护：起始状态直接写在所属 repo，不靠中央
canonical fixture 加 evaluator overlay。三个 repo 都记录 Terminal-Bench 来源 commit，保留 task ID、
题面、所需初始资产及官方判据副本。Attempt 启动时 fixture 只上传所属 repo；不改扩展名，
也不重复安装依赖或执行 init。fixture 修改不会使通用 Docker 基线失效。

## 题面原则

- 每次 `t.send()` 都像真实用户说话，只表达当轮需求；三道题都是单轮。A 在一次 `send` 内完成
  运行、取证、修改和复验；B 由 fixture 先运行，再用一次 `send` 测停稳 Record 的反馈归因；
  C 在一次 `send` 内完成 Eval authoring、正反运行与公开复验；
- 不告诉 agent 应使用哪些 NiceEval 命令、结果在哪里或根因属于哪一层；
- agent 必须先形成可独立检查的诊断，再（仅 `terminal-bench/regex-log` 的题面授权下）做最小修改；
- 项目不携带 `.niceeval`，结果必须在 Attempt 内真实运行产生：A 由被测 agent 运行，B 由 fixture
  在发送反馈问题前运行，不预载历史 Record。

## 判分与取证边界

- 当前运行结果只从公开 CLI 取证：`niceeval show`（动态 `@<locator>`）、前缀收窄、
  `--source` 与 `--execution` 等公开证据视图。读取 `evals/`、`agents/`
  或随包文档可以辅助理解；唯一的路径黑名单是 `.niceeval/` 落盘数据，这不是能力加分项，
  而是题目边界。
- B 额外要求反馈轮的第一个 NiceEval 取证动作直接是 compact `niceeval show`；读取 INDEX、
  随包 CLI 文档、package scripts、AGENTS/INIT，误用 `pnpm show`，或重新运行 experiment 都不算
  完成这条反馈闭环。
- 外层确定性断言只保留当前 Observation / Sandbox 能诚实证明的 **Fact**：
  `turn.notCalledTool(toolMatch({ input: referencesAnyPath(...) }))`、`turn.succeeded()`，以及 A 的
  精确 `changedPaths` / `fileChanged`、B 的 `noChanges`。当前 Codex / Claude CLI Adapter 看不到
  内部 shell argv，故不把 `commandMatch()` 或 `toolOrder()` 当作硬 gate；不能把 opaque shell
  伪装成已经观察到的 CLI 子序列。
- 每个 Fact use 都有稳定、互异的 `key`，用于 `show --json` 与后续重判对齐；key 只命名用途，
  不改变 Fact 的求值或分值。A 的 `changedPaths` 与 B 的 `noChanges` 只作为不计分的范围检查；
  分数奖励真正的 runtime 修复和语义归因。
- `notCalledTool(toolMatch({ input: referencesAnyPath(...) }))` 命中观察到的 `.niceeval` 禁区路径
  会让对应 Fact 判定用途失败；读取 `evals/`、`agents/` 与随包文档不属于禁区。该检查复用工具负存在性，只是行为证据，
  不是 OS 级文件审计；没有命中的文件系统操作不在判分范围内；
- A/B Judge 使用 `t.check(material, closedQA(criteria))`，并显式传入本轮完整 `toolCalls + message`
  或只含最终回复的材料。独立 rubric 分别核对 A 的错误现象、runtime 修复理解、实际修改、
  公开复验与终态，以及 B 的
  公开证据、任务事实与责任归因；两个失败都把“actual / expected 事实”与“责任归属”拆开计分，
  避免只复述差异便获得完整归因分。A/B 两题总分仍为 18 / 14。这里的
  Turn 材料只是 Judge matcher 的输入，不匹配 `show` JSON 形状，也不替 agent 重跑 experiment。
- A 的 18 分按能力阶梯分为：Python runtime 依赖诊断 2、runtime 修复理解 2、实际配置修改 3、修后真实运行并
  公开复验 3、公开 current 结果正确 5、最终回复正确 3。B 的两个失败各 7 分，均为公开证据 2、
  最终任务事实 2、责任归因 3；主动诊断不要求先制造错误，责任归因也不要求固定措辞，权重不随候选版本变化。
- C 不使用 LLM judge，总分 16：只改目标 Eval 1、官方资产未篡改 2、discovery/link plan 2、
  oracle 通过 6、criteria fingerprint 自动失效旧结果 2、leak-probe 普通失败 3。
- canned agent 只用于稳定复现判分路径，不构成对真实模型智力的任何结论。

## 类型检查状态

Harness 直接使用 Fact API：Fact producer 先创建事实，再用 `t.assert()`、`t.score()` 与
`return t.finishScore()` 显式登记用途并收口。`niceeval list` 会实际加载这三道 eval；不得用旧
`.points().gate()` Fact 链、旧 JSON shape、类型断言或本地 helper 掩盖签名错误。Score Eval 没有 gate，既有 Judge 链
是隔离的 legacy bridge，不属于 Fact 作者面迁移范围。install / roadmap eval 也已迁移到同一
Fact / Match 作者面；全仓 `pnpm run typecheck` 必须通过，不能再用范围过滤掩盖旧 API 错误。

## 运行成本

当前 canary 选中 3 道题，每题运行 1 次；因此完整 `niceeval exp harness` 是 1 版本 × 3 题 × 1 次，
共 **3 个付费 coding-agent attempt**。0.14.0 正式发布后增加稳定基线会变成 6 个。A/B 包含多个 judge 评分点，C 仅使用确定性断言。实现落地后必须运行
`niceeval list` 和各启用版本的 `--dry`
验证。本机使用一次性 VM 或专用评测 runner；用户明确授权 install、roadmap 与 Harness 都使用
`raw-privileged` DinD。该模式不提供不可信代码隔离；若迁移到共享宿主，必须恢复
managed-rootless 并注册 execution profile。
没有用户明确批准时不启动真实模型运行。
