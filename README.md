# NiceEval-Eval

用 NiceEval 评估 coding agent 是否能正确安装、迁移和实际使用 NiceEval。这里评的是
NiceEval 的文档链与用户工作流，不是 NiceEval 核心的功能测试。

主仓库当前消费 `niceeval@^0.12.0`。工作区开发时，`pnpm-workspace.yaml` 会把宿主 CLI
链接到相邻的 `../NiceEval` 源码；进入 sandbox 的被测候选仍按明确版本从 npm 安装，
避免把宿主工具与被评版本混为一件事。

## 实验入口

`experiments/` 只保留两个实验族，文件名就是被测 NiceEval 版本：

| 目录 | 回答的问题 | 当前配置 |
| --- | --- | --- |
| `experiments/install/` | coding agent 能否按该版本文档在普通与复杂宿主中完成从零接入 | `v0.11.0` 、`v0.12.0` 、`canary` |
| `experiments/harness/` | coding agent 能否用该版本运行、诊断和修复 NiceEval 工作流 | `v0.9.0`、`v0.12.0`、`canary` |

版本是 experiment 的配置维度，题目类型不再各自建 experiment 目录。`roadmap/` 中已实现的
复杂安装题仍由 `install/<version>` 调度；只保留 Markdown 的未来设计不会被 discovery。

## 评估用例分区

`evals/` 按用户所处阶段分成三组：

| 目录 | 类型 | 回答的问题 | 当前场景 |
| --- | --- | --- | --- |
| `install/` | 安装评估 | 从零开始，agent 能否在真实项目中安装候选版本并写出可用的 config、adapter、eval 和 experiment | DB-GPT、GPT Researcher |
| `roadmap/` | 扩展路线与未来设计 | 复杂第三方接入与暂缓实现的评估方向 | Express Sandbox、Letta、OpenHands、Skyvern，以及 3 个 Harness 设计稿 |
| `harness/` | Harness 工作流评估 | agent 能否自己运行 experiment，并根据反馈归因、修复和 fresh full rerun | 补回归、分层修复 failed、修复局部 errored |

`roadmap/` 下的 `.eval.ts` 是已实现但较复杂的安装路线；`roadmap/harness/*.md` 只是未来
设计。`harness/` 物理上只放当前三道可运行题。

## harness/ 的共享基建与独立 repo

三个候选版本各自形成预装 Node、pnpm、候选 NiceEval 与 init 产物的缓存镜像；三道题则分别
维护 `fixtures/harness/<case>/repo/`。Attempt 只把所属小 repo 复制进已准备 workspace，不在
镜像里共享业务 fixture，也不运行安装或 init。项目不携带 `.niceeval`，结果仍由被测 agent
当场运行产生。完整设计见
[`evals/harness/README.md`](evals/harness/README.md) 与
[`fixtures/harness/README.md`](fixtures/harness/README.md)。

## Harness 的三个确定性场景

这组使用不含历史结果的小型确定性项目：`add-regression` 从“suite 全绿但线上有 bug”开始，
要求先写回归跑红、再修实现跑绿；`repair-failing` 把业务实现错误与过期 eval 混在同一次运行，
要求逐条判断责任层；`repair-errored` 只让依赖 compliance 的两个 case 出错，要求判断 blast
radius 后只修共享配置。题面只表达真实用户需求，具体过程由宿主行为证据与隐藏判分观察。

## 快速开始

```sh
pnpm install
export CODEX_API_KEY=...
export CODEX_BASE_URL=...   # 使用自建 OpenAI-compatible 网关时需要

pnpm run typecheck
pnpm exec niceeval list
```

只生成计划、不启动付费 agent：

```sh
pnpm --silent exec niceeval exp install/v0.12.0 --dry --json
pnpm --silent exec niceeval exp harness/v0.12.0 --dry --json
```

明确决定花费后再运行实验：

```sh
pnpm run install-eval
pnpm run harness-eval
```

结果诊断可优先使用公共 CLI：

```sh
pnpm exec niceeval show --exp <experiment-id>
pnpm exec niceeval show --exp <experiment-id> --history
pnpm exec niceeval show @<locator>
pnpm exec niceeval show @<locator> --execution
pnpm exec niceeval show @<locator> --diff
```

Harness 题不会因为 agent 读取 `.niceeval` 原始记录就预先判错。每轮是否真正用了 shell 由
`turn.calledTool("shell")` 断言；真实工具输出与 agent 回复分别交给 LLM judge 做语义判断，不用
命令正则或 `show` JSON parser；目标产物、结构化配置和业务行为分别使用文件断言、`equals` 与
`runCommand` 隐藏 probe。evaluator 不会代替 agent 重跑 experiment。

## 候选版本与实验矩阵

安装实验族当前有三格：

- `install/v0.12.0`：当前稳定发布基线；
- `install/v0.11.0`：上一代对照；
- `install/canary`：解析运行时的 canary dist-tag。

每个 experiment 都通过 `ensureCandidate()` 物化候选清单，并把解析后的精确版本放进
`flags.candidateVersion`。sandbox 中安装、断言和文档页校验都使用同一个版本值。

三格都跑普通安装题与 roadmap 中已实现的复杂安装题。
安装实验统一使用带 Python 凭证准备的 DinD sandbox；它同时满足 Node 题的运行基线。

Harness 实验族也有三格：`harness/v0.9.0`、`harness/v0.12.0` 与
`harness/canary`。它们运行相同的三道无历史快照反馈闭环题；差异只在镜像内预装的候选
NiceEval 与随包文档版本，不承担跨 reader 的历史 report 兼容测试。每道题固定跑 3 次，完整
矩阵共 27 个 coding-agent attempt；只想检查计划时始终先用 `--dry`。

## 安装评估如何计分

安装题把结论拆成三层：

| 层 | 检查内容 | 作用 |
| --- | --- | --- |
| 安装机制 | 候选版本、config、托管区块、typecheck、eval 可发现性 | gate，判断链路能否工作 |
| 首次评估定题 | 核心评估面、真实数据、成败判据、运行约束、候选范围 | 软分，判断 INIT 是否把安装请求推进成有效 Eval |
| 产出质量 | experiment 与 eval 是否真的覆盖宿主核心用例 | 软分，定位文档契约是否被理解 |
| 完成交接 | 文件与复现命令、真实首跑结果、下一步选择 | 软分，判断 agent 是否交付可继续使用的评估入口 |
| 文档路由 | 是否从随包 `INDEX.md` 读到匹配页面，是否退回在线 main 文档 | 软分，衡量随包文档是否被发现 |

真实项目 fixture 锁定具体 tag：DB-GPT `v0.8.1`，GPT Researcher `v3.6.0`。DB-GPT 使用
sparse checkout 排除与接入无关的大型文档和资源目录。agent 写出的产物会复制到 gitignored
的 `.agent-output/` 供人工复核。

`INIT.md` 在产品中的位置等同于一条 create-eval 入口：用户只说安装，完成标准却是写出并跑通
第一条真实 Eval。因此 DB-GPT 与 GPT Researcher 还会检查 agent 是否先和用户定清评估面、
真实数据、成功与失败判据、运行约束和候选范围，并在结束时如实交代首跑结果、复现入口与下一步。
这些检查复用原安装 Attempt，只增加独立 Judge 计分点，不额外启动一套 coding-agent 任务。

## fixture 与边界

覆盖缺口、双层 failed 和局部 errored 各有自己的 `fixtures/harness/<case>/repo/`。它们共享
候选镜像基建，但不共享业务源码或起始状态；仓库不签入 Harness 历史结果，也不在 attempt 内
安装候选依赖或运行 `niceeval init`。

仓库不验证 NiceEval 核心实现本身；核心 API、CLI 或报告问题应在相邻 `NiceEval/` 修复。
这里也不自动跑全量或付费实验：更换候选、作废结果或批量重跑前必须先确认成本。
