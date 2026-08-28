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
| `experiments/install/` | coding agent 能否按该版本文档在普通与复杂宿主中完成从零接入 | `canary`（0.14.0 发布后补稳定基线） |
| `experiments/harness/` | coding agent 能否用该版本运行、诊断和修复 NiceEval 工作流 | `canary`（0.14.0 发布后补稳定基线） |

版本是 experiment 的配置维度，题目类型不再各自建 experiment 目录。`roadmap/` 中已实现的
复杂安装题仍由 `install/<version>` 调度；只保留 Markdown 的未来设计不会被 discovery。

## 评估用例分区

`evals/` 按用户所处阶段分成三组，全仓共 8 道可发现评估用例：

| 目录 | 类型 | 回答的问题 | 当前场景 |
| --- | --- | --- | --- |
| `install/` | 安装评估 | 从零开始，agent 能否在真实项目中安装候选版本并写出可用的 config、adapter、eval 和 experiment | DB-GPT、GPT Researcher（2 道） |
| `roadmap/` | 扩展路线与未来设计 | 复杂第三方接入与暂缓实现的评估方向 | Express Sandbox、Letta、OpenHands、Skyvern（4 道） |
| `harness/` | Harness 工作流评估 | agent 能否自己运行 experiment，并根据反馈归因、修复和复验 | terminal-bench/regex-log、terminal-bench/log-summary（2 道） |

`install/` 与 `roadmap/` 的每道可运行题都采用 `<case>/eval.ts` 目录入口，因此路径本身继续
给出稳定 Eval ID（例如 `roadmap/openhands`）。场景脚本只保留 setup、任务、检查阶段与收口；
宿主 repo/ref、协议和长 rubric 在 `fixtures/install/<case>/`，跨题机制在
[`lib/install/`](lib/install/README.md)。`roadmap/harness/*.md` 仍只是未来设计；`harness/`
物理上只放当前两道可运行题。

## harness/ 的共享基建与独立 repo

Install 与 Harness 使用同一份只含 Node、pnpm、Docker/Compose 和 guest-init 的通用 Incus base。
Experiment 的声明式 TS action 从固定 digest 构建 inner runtime tags、上传项目 seed，再按版本安装候选
NiceEval、运行 `niceeval init` 并物化 workspace；NiceEval 在 Attempt 派发前逐层发布并复用这些业务 artifact。
base 本身的固定 Ubuntu 输入、构建、block volume 启动验证和安全升级流程位于
[`sandbox/incus-base/`](sandbox/incus-base/README.md)。
两道题分别维护 `fixtures/harness/<case>/repo/`，fixture action 只把所属小 repo 覆盖进已准备
workspace，不在镜像里共享业务 fixture。项目不携带
`.niceeval`，结果仍由被测 agent 当场运行产生。完整设计见
[`evals/harness/README.md`](evals/harness/README.md) 与
[`fixtures/harness/README.md`](fixtures/harness/README.md)。

## Harness 的两个确定性场景

这组使用不含历史结果、从真实 Terminal-Bench 题包裁出的确定性项目：

- `terminal-bench/regex-log` 运行 `hello-world`、`fix-permissions`、`classifier-debug`
  和 `regex-log`，首跑 2 passed / 1 合法 failed / 1 缺 Python errored：唯一修复是
  把 `experiments/local.ts` 的 inner runtime 从 `runtime:node` 改成 `runtime:python`；
  0.14 API / canary 只从公开 `niceeval show` 输出动态取得 locator，恰好 accept 三条仍有效的
  terminal results，只真实重跑 errored 的 `regex-log`；终态为 3/1/0。
- `terminal-bench/log-summary` 运行 `hello-world`、`classifier-debug` 和 `log-summary`，首跑
  1 passed / 2 failed / 0 errored：只诊断不修改——`classifier-debug` 是 agent 选错 B（正确为 A），
  `log-summary` 是合法带引号 CSV 被 exact 字符串断言拒绝，两者都不得靠改断言擦红。

题面只表达真实用户需求，具体过程由宿主行为证据与隐藏判分观察。

## 快速开始

```sh
pnpm install
export CODEX_API_KEY=...
export CODEX_BASE_URL=...   # 使用自建 OpenAI-compatible 网关时需要

pnpm run typecheck
pnpm exec niceeval list
```

当前 Harness 已直接采用下一版 target assertion API（scope-first 短断言面）；在 NiceEval
补齐 `commandMatch()`、`referencesAnyPath()`、无 name `toolMatch({ input })` 与对应 scoped assertion 签名前，`pnpm run typecheck`
和加载 Harness eval 都会明确失败。这是已知依赖，不得用旧 JSON shape、正则 matcher、
类型断言或本地 helper 绕过。

只生成计划、不启动付费 agent：

```sh
pnpm --silent exec niceeval exp install/canary --dry --json
pnpm --silent exec niceeval exp harness/canary --dry --json
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

Harness 题会把 observed tool input 中直接读取 `.niceeval`、`evals` 或 `agents` 的行为记为零分，
但这不是 OS 级文件审计。取证只承认公开 `niceeval show`：动态 `@<locator>`、
前缀收窄、`--source` 与 `--execution` 证据视图。外层
确定性断言是 scope-first 的窄锚点：`commandMatch(executable, { argsStart, excludes,
status? })` 本身就是匹配同一笔 logical tool occurrence 的 `ToolMatch`（没有直接传
`{ name, status }`、command tuple、嵌套 command selector 或 sequential 旧形态），只锚定本轮 `t.send()` 内调过 `niceeval exp local` /
`niceeval show` 这类窄事实；其中 executable 是逻辑命令，direct、`pnpm exec`、
`pnpm --silent exec` 与无 runner option 的 `npx` 由 Observation Protocol 统一投影，Eval
不枚举 wrapper。禁区检查复用
`notCalledTool(toolMatch({ input: referencesAnyPath(...) }))`，不另造 scoped negative 方法。
Judge 使用 `turn.check({ input, output }, closedQA(criteria))` 或
`t.check(material, closedQA(criteria))`，显式传入本轮 `toolCalls + message` 或最终回复；
材料只是公开 Turn 的传输形状，不匹配 `show` JSON，也不替 agent 重跑 experiment。
canned agent 只用于稳定复现，不代表真实模型智力。

## 本地 Incus dogfood

本机默认走 development Incus domain：`project` `niceeval-eval-dev`、`storagePool`
`niceeval-sandbox-dev`，并显式 `acceptDevelopmentDomain: true`。这条路径的结果
**non-comparable**，不能当成 reference 通过。实验直接固定 it-infra 已部署并信任的通用
`niceeval-eval-base@sha256:...`；不需要项目 `.env`。NiceEval 不 build / import / pull base，
也不接受 `ubuntu:latest` 一类可变引用；业务 SetupPrefix 可以在 guest 内拉取固定 digest 的
inner runtime。可复现 builder 与升级步骤见
[`sandbox/incus-base/`](sandbox/incus-base/README.md)。

被测 Codex Agent 默认使用只向 Incus VM 暴露 Responses API 的集群专用 TLS endpoint
`https://sub2api.350124.xyz:18443/v1`。每个 Attempt 在命中业务缓存后重放受控 hosts
映射并验证系统 CA、固定 ClusterIP 和精确路由；映射不会进入 SetupPrefix artifact。
`NICEEVAL_INCUS_CODEX_BASE_URL` 可覆盖 base URL：

```sh
export NICEEVAL_INCUS_CODEX_BASE_URL='https://sub2api.350124.xyz:18443/v1'
```

隔离 VM 无法访问仅限内网或 Tailnet 的 endpoint，不能把宿主 Tailscale 地址
`100.67.1.82:443` 配给它。鉴权仍只通过 `CODEX_API_KEY` 进入 Attempt；不要把 token 写进
SetupPrefix、镜像、声明式 action 或文档。

reference domain（`niceeval-eval` / `niceeval-evals`）若未部署，
`niceeval sandbox provider doctor incus` 与未接受 development 的 dry plan 会给出 typed
red（例如 `incus-undeployed`）。本机开发检查用
`niceeval sandbox provider doctor incus --development`。

## 候选版本与实验矩阵

安装实验族从 0.14 API 开始，当前只有 canary 一格：

- `install/canary`：解析运行时的 canary dist-tag。

`niceeval@0.14.0` 正式发布后再增加 `install/v0.14.0` 稳定基线；发布前不创建会让
experiment discovery 整体失败的虚假精确版本。

每个 experiment 都通过 `ensureCandidate()` 物化候选清单，并把解析后的精确版本放进
`flags.candidateVersion`。sandbox 中安装、断言和文档页校验都使用同一个版本值。

启用的格都跑普通安装题与 roadmap 中已实现的复杂安装题。
安装实验统一使用一次性 Incus VM（Docker-in-disposable-VM，V1 DestroyOnly）。共享业务
SetupPrefix 从固定 digest 构建并验证联网 Sandbox 中的本地缓存镜像
`cache.invalid/niceeval-install/runtime:python`；后续
Eval layer 再 checkout 各自源码。通用 base 不含 inner runtime、NiceEval、应用依赖、服务、
Eval 答案或历史结果；被测 agent 仍须自行安装候选与
应用依赖、启动真实服务、编写三件套并实际运行首条最小 experiment。

Harness 实验族同样从 0.14 API 开始，当前只启用 `harness/canary`；0.14.0 发布后补
`harness/v0.14.0` 稳定对照。它运行三道 Harness 题，不承担跨 reader 的历史 report
兼容测试。`attempts` 使用 NiceEval 的默认值 1，当前完整矩阵共 **3 个
coding-agent attempt**。全仓并发上限为 2：安装题的宿主 checkout、Codex session 与
guest Docker 会同时占用大量内存和临时空间。只想检查计划时始终先用 `--dry`。

## 安装评估如何计分

安装题把结论拆成三层：

| 层 | 检查内容 | 作用 |
| --- | --- | --- |
| 安装机制 | 候选版本、config、托管区块、typecheck、eval 可发现性 | 分项计分，衡量链路完成度 |
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

`terminal-bench/regex-log` 与 `terminal-bench/log-summary` 各有自己的
`fixtures/harness/<case>/repo/`。
它们共享唯一的通用 Incus base，但不共享业务源码或起始状态；仓库不签入 Harness 历史结果。
Experiment 的声明式 `before` action 从固定 digest 准备 inner runtime tag、上传项目 seed、按候选
版本运行 `niceeval init` 并物化只读依赖树，随后才上传所属 fixture。每一层成功准备后都作为
provider-native SetupPrefix artifact 发布并按其声明式 identity 复用；本地 tag 的
`--pull=never` 冒烟仍验证 node/git/python3 与 `.invalid` 缺失即失败的契约。

仓库不验证 NiceEval 核心实现本身；核心 API、CLI 或报告问题应在相邻 `NiceEval/` 修复。
这里也不自动跑全量或付费实验：更换候选、作废结果或批量重跑前必须先确认成本。
