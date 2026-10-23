# NiceEval-Eval

用 NiceEval 评估 coding agent 是否能正确安装、迁移和实际使用 NiceEval。这里评的是
NiceEval 的文档链与用户工作流，不是 NiceEval 核心的功能测试。

主仓库固定消费 npm 发布的 `niceeval@0.19.0`，不再通过 workspace override 链接相邻源码。
进入 sandbox 的被测候选仍由各 Experiment 明确指定，旧版对照继续保留。

## 实验入口

`experiments/` 只保留两个实验族，文件名就是被测 NiceEval 版本：

| 目录 | 回答的问题 | 当前配置 |
| --- | --- | --- |
| `experiments/install/` | coding agent 能否按该版本文档在真实宿主中完成从零接入 | `v0.14.0`、`v0.14.3`、`v0.19.0`、`canary` |
| `experiments/harness/` | coding agent 能否用该版本运行、诊断和修复 NiceEval 工作流 | `v0.14.0`、`v0.14.3`、`v0.19.0`、`canary` |

版本是 experiment 的配置维度，题目类型不各自建 experiment 目录。

## 评估用例分区

`evals/` 按用户所处阶段分成两组，全仓共 6 道可发现评估用例：

| 目录 | 类型 | 回答的问题 | 当前场景 |
| --- | --- | --- | --- |
| `install/` | 安装评估 | 从零开始，agent 能否在真实项目中安装候选版本并写出可用的 config、adapter、eval 和 experiment | DB-GPT、GPT Researcher（2 道） |
| `harness/` | Harness 工作流评估 | agent 能否自己运行 experiment，并根据反馈归因、修复和复验 | 三个任务家族、四个独立条件（含自主/明确授权修复配对） |

`install/` 的每道题都采用 `<case>/eval.ts` 目录入口，路径本身给出稳定 Eval ID（例如
`install/db-gpt`）。每道题自己持有宿主 fixture、续轮回答与全部判据，读一个文件就能看到它测什么、
什么算通过；[`lib/install-probes.ts`](lib/install-probes.ts) 只放不登记检查的取证探针与归档，
交接 locator 的终态经候选的公开 `niceeval query` 读取。

## harness/ 的共享基建与独立 repo

Install 与 Harness 使用同一份只含 Node、pnpm、Docker/Compose 和 guest-init 的通用 Incus base。
Experiment 的声明式 TS action 从固定 digest 构建 inner runtime tags、上传项目 seed，再按版本安装候选
NiceEval、运行 `niceeval init` 并物化 workspace；NiceEval 在 Attempt 派发前逐层发布并复用这些业务 artifact。
base 本身的固定 Ubuntu 输入、构建、block volume 启动验证和安全升级流程位于
[`sandbox/incus-base/`](sandbox/incus-base/README.md)。
三个任务家族分别维护 `fixtures/harness/<case>/repo/`，fixture action 只把所属小 repo 覆盖进已准备
workspace，不在镜像里共享业务 fixture。项目不携带
`.niceeval`，结果仍由被测 agent 当场运行产生。完整设计见
[`evals/harness/README.md`](evals/harness/README.md) 与
[`fixtures/harness/README.md`](fixtures/harness/README.md)。

## Harness 评分与发版比较

当前使用 rubric v2：自主恢复 10 分、明确授权恢复 10 分、只读归因 14 分、authoring 18 分。
真实结果通过公开 query 核验；分数、完成事实与修改范围分别报告。历史 32/48 不能直接
与新分数相减。安装前 INIT 的效果由 install 题覆盖，不由预装好的 Harness 题代替。

详见 [题库与评分](evals/harness/README.md) 和 [发布评估协议](docs/harness-release-evaluation.md)。

## 快速开始

```sh
pnpm install
export CODEX_API_KEY=...
export CODEX_BASE_URL=...   # 使用自建 OpenAI-compatible 网关时需要

pnpm run typecheck
pnpm exec niceeval list
```

宿主已迁移到 0.19 的 `adapter`、`judgeProvider`、`reply` 与 Query v2 API。
本次新增 `install/v0.19.0` 和 `harness/v0.19.0`；后者覆盖 debug、修复与 authoring 工作流。

只生成计划、不启动付费 agent：

```sh
pnpm --silent exec niceeval exp install/v0.19.0 --dry --json
pnpm --silent exec niceeval exp harness/v0.19.0 --dry --json
```

明确决定花费后再运行实验：

```sh
pnpm run install-eval
pnpm run harness-eval
```

结果诊断可优先使用公共 CLI：

```sh
pnpm exec niceeval show --experiment <experiment-id>
pnpm exec niceeval show --run <run-id>
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
Judge 使用 `turn.closeQA(judgeEvidence(material), criteria)` 或
`t.closeQA(judgeEvidence(material), criteria)`，显式传入本轮 `toolCalls + reply` 或最终回复；
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

安装实验族从 0.14 API 开始，当前有三个稳定版与 canary 四格：

- `install/v0.14.0`：固定 `niceeval@0.14.0` 稳定基线；
- `install/v0.14.3`：固定 `niceeval@0.14.3` 历史对照；
- `install/v0.19.0`：固定 `niceeval@0.19.0` 当前候选；
- `install/canary`：解析运行时的 canary dist-tag。

每个 experiment 都通过 `ensureCandidate()` 物化候选清单，并把解析后的精确版本放进
`flags.candidateVersion`。sandbox 中安装、断言和文档页校验都使用同一个版本值。

当前 install Experiment 选择 `install/` 的两道安装题。
安装实验统一使用一次性 Incus VM（Docker-in-disposable-VM，V1 DestroyOnly）。共享业务
SetupPrefix 从固定 digest 构建并验证联网 Sandbox 中的本地缓存镜像
`cache.invalid/niceeval-install/runtime:python`；后续
Eval layer 再 checkout 各自源码。通用 base 不含 inner runtime、NiceEval、应用依赖、服务、
Eval 答案或历史结果；被测 agent 仍须自行安装候选与
应用依赖、启动真实服务、编写三件套并实际运行首条最小 experiment。

Harness 当前启用 `harness/v0.14.0`、`harness/v0.14.3`、`harness/v0.19.0` 与 `harness/canary`。
每个候选运行四个独立条件，显式固定 1 Attempt、medium 推理设置并关闭首过即停。
完整矩阵最多 16 个 coding-agent attempts，另计 Judge 调用。全仓并发上限为 2；
只想检查计划时使用 `--dry`。新评分基线与发布比较见上方 Harness 说明。

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

## 0.19 迁移验证与历史结果

`pnpm run typecheck` 与 `pnpm run test:harness` 验证宿主类型和公开 CLI 的运行、修复、沿用及
失效重跑链路，不调用付费模型。内层 fixture 根据候选版本选择 `agent` / `adapter`；结果检查
按候选选择 Query v1 / v2，避免破坏 0.14 对照。0.19 的 `run.get` 同时提供计划、结果和用量。

若旧 `.niceeval` 报 `record-schema-unsupported` 或旧 ProjectDatabase owner 未释放，保留完整
现场，按随包 `tutorials/agent-feedback-loop.mdx` 与 `troubleshooting/debugging.mdx` 在不含
`.niceeval` 的项目副本验证。不要删除锁或历史结果来绕过检查。静态计划通过不代表真实 Incus
或模型评估已通过；真实运行仍需明确成本授权。
