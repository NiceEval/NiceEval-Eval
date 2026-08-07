# NiceEval-Eval

用 NiceEval 评估 coding agent 是否能正确安装、迁移和实际使用 NiceEval。这里评的是
NiceEval 的文档链与用户工作流，不是 NiceEval 核心的功能测试。

主仓库当前消费 `niceeval@^0.12.0`。工作区开发时，`pnpm-workspace.yaml` 会把宿主 CLI
链接到相邻的 `../NiceEval` 源码；进入 E2B sandbox 的被测候选仍按明确版本从 npm 安装，
避免把宿主工具与被评版本混为一件事。

## 实验入口

`experiments/` 只保留两个实验族，文件名就是被测 NiceEval 版本：

| 目录 | 回答的问题 | 当前配置 |
| --- | --- | --- |
| `experiments/install/` | coding agent 能否按该版本文档在普通与复杂宿主中完成从零接入 | `v0.11.0` 、`v0.12.0` 、`canary` |
| `experiments/harness/` | coding agent 能否用该版本运行、诊断、修复或迁移 NiceEval 工作流 | `v0.9.1` 、`v0.12.0` |

版本是 experiment 的配置维度，题目类型不再各自建 experiment 目录。`advance/`
仍是安装题的独立 eval 分区，由 `install/<version>` 调度；原 `experiment/` 已并入
`harness/`，由版本 tag 分流。

## 评估用例分区

`evals/` 按用户所处阶段分成三组：

| 目录 | 类型 | 回答的问题 | 当前场景 |
| --- | --- | --- | --- |
| `install/` | 安装评估 | 从零开始，agent 能否在真实项目中安装候选版本并写出可用的 config、adapter、eval 和 experiment | DB-GPT、GPT Researcher |
| `advance/` | 高级安装评估 | 遇到复杂运行环境和第三方 agent 时，能否选择合适的接入层与 sandbox | Express coding-agent Sandbox、Letta、OpenHands、Skyvern |
| `harness/` | Harness 工作流评估 | agent 能否运行、读结果、调试、自迭代、迁移，并守住证据边界 | 0.9.1 历史诊断 8 题 + 0.12.0 反馈闭环 3 题 |

`install/` 和 `advance/` 都属于“把 NiceEval 装进去”，区别是前者覆盖常见真实项目，
后者专门保留复杂 provider、sandbox 与框架集成路径。`harness/` 则专门考
NiceEval 已存在时的使用与反馈闭环。

## harness/ 的 folder-local 题包

`harness/` 不从中央 fixture 出题。每条用例都是
`evals/harness/<id>/{eval.ts,README.md,repo/}`：题面、中文设计说明和 agent 的
完整起始仓库共址，删除其它题后仍能单独运行。0.9.1 组覆盖过期概览、
成本/通过率权衡、失败断言定位、执行轨迹与证据边界。完整设计见
[`evals/harness/README.md`](evals/harness/README.md)。

每个 `repo/` 独立携带同一份真实历史项目快照。README 只供 harness 维护者阅读，不上传给 agent；
repo 内的 `*.ts.fixture` 会在 agent 开始前恢复为原始 `.ts`，避免内层项目被宿主 discovery 误收。

## harness/v0.12.0 的三个确定性场景

这组使用仓库内的小型项目夹具，不调用夹具自身的外部模型，因此能稳定验证 agent 是否真的
完成了 NiceEval 工作流。

### `run-existing`

项目和实验一开始就是绿色。agent 必须读取随包 `INDEX.md`，运行 `local` experiment，
再用 `niceeval show` 核对 verdict 与计数；不应修改项目，也不能直接读取 `.niceeval` 原始 JSON。

### `repair-failing`

harness 会在 agent 开始前先跑一次，并确认实验以 exit code 1 失败。失败原因是业务源码返回
“14 days”，eval 要求“30 days”。agent 必须：

1. 用 `--rerun all` 复现失败；
2. 从输出取得 locator，并用 `niceeval show @<locator>` 下钻；
3. 只修 `src/policy.ts`，不得改 agent、eval、experiment 或断言；
4. 局部重跑到全绿，再用 `show` 核对。

harness 在 agent 结束后会独立重跑，避免只凭最终回复判断成功。

### `migrate-0.9`

夹具先固定在 `niceeval@0.9.1`，并保留旧写法：`defineAgent` 与 experiment 的 `runs`。
agent 要把依赖升级到候选版本，重新执行 `niceeval init`，只依据升级后的随包文档迁移到
`defineDirectAgent`、显式 evidence coverage 与 `attempts`，最后跑完实验并用 `show` 验证。

这个场景同时检查依赖版本、源码迁移和最终执行结果，不接受“改到能编译”为完成。

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
pnpm --silent exec niceeval exp harness/v0.9.1 --dry --json
pnpm --silent exec niceeval exp harness/v0.12.0 --dry --json
```

明确决定花费后再运行实验：

```sh
pnpm run install-eval
pnpm run harness-eval
```

结果诊断只走 CLI：

```sh
pnpm exec niceeval show --exp <experiment-id>
pnpm exec niceeval show --exp <experiment-id> --history
pnpm exec niceeval show @<locator>
pnpm exec niceeval show @<locator> --execution
pnpm exec niceeval show @<locator> --diff
```

不要直接读取 `.niceeval/result.json`、`run.json` 或 `sources/*.json`。CLI 看不到需要的信息时，
应把它记录成 NiceEval 的呈现缺口，而不是绕过 CLI 解析内部文件。

## 候选版本与实验矩阵

安装实验族当前有三格：

- `install/v0.12.0`：当前稳定发布基线；
- `install/v0.11.0`：上一代对照；
- `install/canary`：解析运行时的 canary dist-tag。

每个 experiment 都通过 `ensureCandidate()` 物化候选清单，并把解析后的精确版本放进
`flags.candidateVersion`。sandbox 中安装、断言和文档页校验都使用同一个版本值。

三格都跑普通安装与高级安装题。
安装实验统一使用带 Python 凭证准备的 DinD sandbox；它同时满足 Node 题的运行基线。

`harness/v0.9.1` 的 folder-local repo 读取 NiceEval 0.4.6 产出的 schema 8 历史快照；
0.9.1 是最后验证过完整兼容的 reader。`harness/v0.12.0` 不读这批旧结果，而是使用
自己的确定性 repo 跑首跑、失败修复和长程迁移，因此两格都有真实可运行的版本语义。

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

`evals/harness/<id>/repo/` 是每题自己的完整起始仓库。绿色项目、确定性红色
项目、旧 API 迁移项目和历史结果都与对应 eval 共址；仓库不再有中央 `fixtures/` 目录。

仓库不验证 NiceEval 核心实现本身；核心 API、CLI 或报告问题应在相邻 `NiceEval/` 修复。
这里也不自动跑全量或付费实验：更换候选、作废结果或批量重跑前必须先确认成本。
