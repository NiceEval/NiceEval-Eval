# Harness 评估套件

这组题评估 coding agent 能否在一个已经接入 NiceEval 的项目里，自主完成“运行 → 用公开
`niceeval show` 取证 → 形成因果判断 → 在正确层修改/给出归因”。两题共享运行基建，
但各自维护独立项目与独立起始状态；完整矩阵为 3 版本 × 2 题 × 3 次，共 **18 个付费
coding-agent attempt**。

## 当前两题

| 用例 | 用户交互 | 初始状态 | 主要能力 |
| --- | --- | --- | --- |
| `terminal-bench/regex-log` | 单轮：把评估跑完并报告最终结果，题面不预告 error | 真实 TB task slice 首跑 2 passed / 1 合法 failed / 1 缺 Python errored | 自主识别未完成的 errored、定位 experiment runtime 缺口、最小修改恢复、按候选版本差异复验 |
| `terminal-bench/log-summary` | 单轮：运行并解释每个失败，未授权修改 | 真实 TB task slice 首跑 1 passed / 2 failed / 0 errored | 区分「agent 产出错误」与「eval 过紧」，给出正确因果归因 |

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

- 候选为 0.12.x / canary 时，从公开 `niceeval show` 输出动态取得 locator，恰好 accept
  三条仍有效的 terminal results（`hello-world`、`fix-permissions`、`classifier-debug`），只真实
  重跑被改动影响的 `regex-log`；
- 候选为 0.9.x 时没有 locator accept，必须真实完整重跑四题，得到的数字完全一致。

两代候选的终态相同：**3 passed / 1 failed / 0 errored**——合法 failed 的那道不因换运行时
而改变，它本来就不是环境问题。题目考察的是 agent 能否从 CLI 反馈把「errored 的环境缺口」
与「failed 的业务事实」分开，而不是让它把所有红灯都“修绿”。

### B · terminal-bench/log-summary

用户只要求运行评估并解释每个失败，没有授权修改项目文件。这里测的是 agent
能否把已完成的 `failed` 当作需要归因的结果，而不是必须被“修绿”的执行错误。

inner project 首跑 **1 passed / 2 failed / 0 errored**。agent 的任务是逐道给出因果归因并
如实交接，**不得修改任何 eval 或项目文件**：

- `terminal-bench/classifier-debug`：正确选项与断言要求都是 A，canned agent 却写入 B。这是
  **agent 产出/能力问题**，断言本身是对的；
- `terminal-bench/log-summary`：ERROR/WARNING/INFO 计数是正确的 4/3/8，输出也是合法 CSV，
  只是字段带标准双引号。TB 官方 CSV 判据会接受，本地 exact 字符串断言却拒绝——这是
  **eval 过紧**。

正确完成 = 两道失败都归因到正确层、不产生任何文件改动；错误完成 = 靠改断言、放宽匹配或
改 fixture 让套件变绿，或把两类失败互相张冠李戴。

## 共享基建，独立 repo

Node、pnpm、Docker/Compose、精确候选 NiceEval、依赖和 `niceeval init` 产物在候选镜像中
共享。0.9.0、0.12.0 与解析后的 canary 各有独立缓存镜像。每个候选镜像还物化两枚**完全离线**
的 inner runtime 归档（node / python 变体），由 entrypoint 在 inner dockerd 就绪后
`docker import` 成两个本地 tag，见 [`fixtures/harness/README.md`](../../fixtures/harness/README.md)。
三个 Harness experiment 都把 `maxConcurrency` 固定为 `1`：单个 Attempt 已同时占用候选
Sandbox 与内层 dockerd，串行口径避免宿主资源竞争和模型网关并发抖动混入候选差异。

`fixtures/harness/<case>/repo/` 由每道题各自维护：起始状态直接写在所属 repo，不靠中央
canonical fixture 加 evaluator overlay。两个 repo 都记录 Terminal-Bench 来源 commit，保留 task ID、
题面、所需初始资产及官方判据副本。Attempt 启动时只上传所属 repo；不改扩展名、
不安装依赖、不执行 init。fixture 修改也不会使 Docker 依赖层失效。

## 题面原则

- 每次 `t.send()` 都像真实用户说话，只表达当轮需求；两道题都是单轮，一次 `send` 内完成
  运行、取证、修改或归因；
- 不告诉 agent 应使用哪些 NiceEval 命令、结果在哪里或根因属于哪一层；
- agent 必须先形成可独立检查的诊断，再（仅 `terminal-bench/regex-log` 的题面授权下）做最小修改；
- 项目不携带 `.niceeval`，结果必须由被测 agent 当场运行产生。

## 判分与取证边界

- Agent 取证只走公开 CLI：`niceeval show`（动态 `@<locator>`）、前缀收窄、0.9.x 的
  `--eval` / 0.12+ 的 `--source`，以及 `--execution` 等公开证据视图。**禁止**以读取
  `.niceeval/` 落盘产物或 `evals/`、`agents/`
  源码代替取证；这不是能力加分项，而是题目边界。
- 外层确定性断言只保留当前 Observation / Sandbox 能诚实证明的 **Fact**：
  `turn.notCalledTool(toolMatch({ input: referencesAnyPath(...) }))`、`turn.succeeded()`，以及 A 的
  精确 `changedPaths` / `fileChanged`、B 的 `noChanges`。当前 Codex / Claude CLI Adapter 看不到
  内部 shell argv，故不把 `commandMatch()` 或 `toolOrder()` 当作硬 gate；不能把 opaque shell
  伪装成已经观察到的 CLI 子序列。
- 每个 Fact use 都有稳定、互异的 `key`，用于 `show --json` 与后续重判对齐；key 只命名用途，
  不改变 Fact 的求值或分值。一个 Fact 同时用于观察和计分时仍只创建一次。
- `notCalledTool(toolMatch({ input: referencesAnyPath(...) }))` 命中观察到的禁区路径
  （`.niceeval`、`evals`、`agents`）会让对应 Fact 判定用途失败；它复用工具负存在性，只是行为证据，
  不是 OS 级文件审计；没有命中的文件系统操作不在判分范围内；
- Judge 继续使用现有 `turn.judge.autoevals.closedQA()`，并通过 `{ on }` 显式传入本轮完整
  `toolCalls + message`。既有完整 Turn rubric 负责运行 → show → 动态 locator → 下钻 → 最终回复的
  有序语义，以及 CLI 输出计数、归因与复验结论；不增加 Judge 次数或分数。这里的
  `JSON.stringify()` 只是把公开 Turn 材料传给只接受 string 的现有入口，不匹配 `show` JSON
  形状，也不替 agent 重跑 experiment。
- canned agent 只用于稳定复现判分路径，不构成对真实模型智力的任何结论。

## 类型检查状态

Harness 直接使用 Fact API：Fact producer 先创建事实，再用 `t.assert()`、`t.score()` 与
`return t.finishScore()` 显式登记用途并收口。`niceeval list` 会实际加载这两道 eval；不得用旧
`.points().gate()` Fact 链、旧 JSON shape、类型断言或本地 helper 掩盖签名错误。Score Eval 没有 gate，既有 Judge 链
是隔离的 legacy bridge，不属于 Fact 作者面迁移范围。install / roadmap eval 也已迁移到同一
Fact / Match 作者面；全仓 `pnpm run typecheck` 必须通过，不能再用范围过滤掩盖旧 API 错误。

## 运行成本

每个版本选中 2 道题，每题运行 3 次，避免把 coding agent 的单次随机性误判成候选文档差异；
因此完整 `niceeval exp harness` 是 3 版本 × 2 题 × 3 次，共 **18 个付费 coding-agent
attempt**，且每次包含多个 judge 评分点。实现落地后必须运行 `niceeval list` 和各版本的 `--dry`
验证。本机使用一次性 VM 或专用评测 runner；用户明确授权 install、roadmap 与 Harness 都使用
`raw-privileged` DinD。该模式不提供不可信代码隔离；若迁移到共享宿主，必须恢复
managed-rootless 并注册 execution profile。
没有用户明确批准时不启动真实模型运行。
