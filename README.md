# NiceEval-Eval

用 NiceEval 评估 coding agent 是否能正确安装、迁移和实际使用 NiceEval。这里评的是
NiceEval 的文档链与用户工作流，不是 NiceEval 核心的功能测试。

主仓库依赖固定为 npm 发布的 `niceeval@0.19.1-canary.104`；本地候选验证可使用官方 `pnpm dev:link`。
被测对象保留最新稳定版 `0.19.0` 与 Canary；Canary 在 Experiment 加载时解析为精确版本。更早版本不参与矩阵。

## 实验入口

`experiments/` 只保留两个实验族，文件名就是被测 NiceEval 版本：

| 目录 | 回答的问题 | 当前配置 |
| --- | --- | --- |
| `experiments/install/` | coding agent 只拿到一句 prompt 和该版本 INIT.md，能否在真实宿主中完成从零接入 | `v0.19.0`、`canary` |
| `experiments/harness/` | 已装好的项目里，coding agent 能否只靠随包文档运行、诊断和修复 NiceEval 工作流 | `v0.19.0`、`canary` |

版本是 experiment 的配置维度，题目类型不各自建 experiment 目录。

## 评估用例分区

`evals/` 按用户所处阶段分成两组，全仓共 6 道可发现评估用例：

| 目录 | 类型 | 回答的问题 | 当前场景 |
| --- | --- | --- | --- |
| `install/` | 安装评估 | 从零开始，agent 能否在真实项目中安装候选版本并写出可用的 config、adapter、eval 和 experiment | DB-GPT、GPT Researcher（2 道） |
| `harness/` | Harness 工作流评估 | agent 能否自己运行 experiment，并根据反馈归因、修复和复验 | 三个任务家族、四个独立条件（含自主/明确授权修复配对） |

`install/` 的每道题都采用 `<case>/eval.ts` 目录入口，路径本身给出稳定 Eval ID（例如
`install/db-gpt`）。每道题自己持有宿主 fixture、续轮回答与全部判据，读一个文件就能看到它测什么、
什么算通过；[`lib/install-probes.ts`](lib/install-probes.ts) 只放不登记检查的取证探针与归档。
运行结果一律经被测项目自己的 `niceeval query` / `exp --json` 读取，[`lib/query.ts`](lib/query.ts)
只做传输，不认识业务字段。

## harness/ 的共享基建与独立 repo

Install 与 Harness 使用 it-infra 部署的固定 digest OpenSandbox/Kata 镜像。
每个 Attempt 独立创建沙箱，显式启动 guest Docker，并检查 Node、pnpm、Docker 和 Compose。
Experiment 的声明式 TS action 从固定 digest 准备 inner runtime tags、上传项目 seed，再按版本安装候选
NiceEval、运行 `niceeval init` 并物化 workspace。支持 rootfs Snapshot 的本地 NiceEval 候选可缓存这些准备步骤；
inner runtime 先导出为镜像归档，停止准备用的 Docker daemon 并卸载临时 data-root，恢复后再启动独立 daemon 导入归档。
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


只生成计划、不启动付费 agent：

```sh
pnpm --silent exec niceeval exp install/canary --dry --json
pnpm --silent exec niceeval exp harness/canary --dry --json
```

明确决定花费后再运行实验：

```sh
pnpm exec niceeval exp install
pnpm exec niceeval exp harness
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

## 本地 OpenSandbox 运行

宿主配置 `OPEN_SANDBOX_DOMAIN` 与 `OPEN_SANDBOX_API_KEY`，只用于连接服务，不传入 guest。
`lib/experiment-runtime.ts` 固定已部署镜像 digest，申请 2 CPU / 8 GiB 和 90 分钟 TTL；
每个 Attempt 正常结束立即调用销毁，整仓并发为 1，以匹配当前部署配额。

2026-10-26 用户明确接受普通执行路径，不要求 `docker/v1` 强生命周期保证。
因此 Eval 不声明该 capability；仍实际验证 Docker/Compose，保留所有业务判据。
Kubernetes 异步删除与创建响应丢失的上游边界仍存在，运行成功不作为强终止保证的认证。
历史 Incus 构建材料保留在 `sandbox/incus-base/`，不参与当前运行。

被测 Codex 使用 `https://s2a.niceeval.com/v1`，可通过
`NICEEVAL_OPENSANDBOX_CODEX_BASE_URL` 显式覆盖。`CODEX_API_KEY` 仍由官方 adapter 注入。
目标应用长期 key 只留在宿主；Attempt 级代理绑定 `10.42.0.1:18180`，guest 仅持有短期 token。
现有 Tailnet 信任规则仍适用，代理通过 token 认证；不把绑定地址当作独占入站接口保证。

## 候选版本与实验矩阵

- `install/v0.19.0`、`install/canary`：agent 收到官网首页那句 prompt，URL 指向该版本 tag 下的 INIT.md，
  另加一句版本要求（INIT.md 默认安装 npm latest）。
- `harness/v0.19.0`：固定最新稳定版 `niceeval@0.19.0`；
- `harness/canary`：每次加载时从 npm 全部已发布版本按 semver 取最大值（含预发布版，同一 core 下正式版优先）。
  Harness 的项目已装好候选并运行过 `niceeval init`，agent 只能依靠随包文档。

每个 experiment 都通过 `ensureCandidate()` 物化候选清单，并把解析后的精确版本放进
`flags.candidateVersion`。sandbox 中安装、断言和文档页校验都使用同一个版本值。

当前 install Experiment 选择 `install/` 的两道安装题。
安装实验统一使用一次性 OpenSandbox/Kata 实例。准备步骤从固定 digest 构建并验证本地镜像
`cache.invalid/niceeval-install/runtime:python`；后续
Eval layer 再 checkout 各自源码。通用 base 不含 inner runtime、NiceEval、应用依赖、服务、
Eval 答案或历史结果；被测 agent 仍须自行安装候选与
应用依赖、启动真实服务、编写三件套并实际运行首条最小 experiment。
安装题不限制被测 agent 的格数、Attempt 数或运行轮次；它可自主诊断、修复和重试，
无需追加运行授权。代理不设累计请求上限或独立的会话倒计时，随 Attempt 回收；
并发与单次传输保护仍保留。外层每个候选的一次 coding-agent 采样与内层自主多轮运行不同。
成本比较计入所有运行的实际可用用量；缺失费用保持未知，不按零计算。
多轮取证与回收规则见[安装题自主运行](docs/install-autonomous-runs.md)。

Harness 启用 `harness/v0.19.0` 与 `harness/canary`。
每个候选运行四个独立条件，显式固定 1 Attempt、medium 推理设置并关闭首过即停。
Harness 共 8 个 coding-agent attempts，全仓共 12 格，另计 Judge 调用。全仓并发上限为 1；
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

GPT Researcher 的运行选择使用内置 DuckDuckGo 搜索，目标模型沿用服务默认值，不依赖
Tavily key。真实响应评分结合 agent 交接时的 Adapter/Eval 源码与各当前 Attempt 的公开执行
证据，要求至少一个正向核心用例产生真实业务响应；预期负例允许拒答或合法错误。所有当前
结果仍须能由源码解释，且任何 mock、echo 或替代目标服务的实现都不能通过真实响应门槛。

`INIT.md` 在产品中的位置等同于一条 create-eval 入口：用户只说安装，完成标准却是写出并跑通
第一条真实 Eval。因此 DB-GPT 与 GPT Researcher 还会检查 agent 是否先和用户定清评估面、
真实数据、成功与失败判据、运行约束和候选范围，并在结束时如实交代首跑结果、复现入口与下一步。
这些检查复用原安装 Attempt，只增加独立 Judge 计分点，不额外启动一套 coding-agent 任务。

## fixture 与边界

`terminal-bench/regex-log` 与 `terminal-bench/log-summary` 各有自己的
`fixtures/harness/<case>/repo/`。
它们使用同一个通用 OpenSandbox 镜像，但不共享业务源码或起始状态；仓库不签入 Harness 历史结果。
Experiment 的声明式 `before` action 从固定 digest 准备 inner runtime tag、上传项目 seed、按候选
版本运行 `niceeval init` 并物化只读依赖树，随后才上传所属 fixture。每个 Attempt 都重新准备；本地 tag 的
`--pull=never` 冒烟仍验证 node/git/python3 与 `.invalid` 缺失即失败的契约。

仓库不验证 NiceEval 核心实现本身；核心 API、CLI 或报告问题应在相邻 `NiceEval/` 修复。
这里也不自动跑全量或付费实验：更换候选、作废结果或批量重跑前必须先确认成本。

## 本地验证与历史结果

OpenSandbox 迁移的当前进展、得分与限制见 [2026-10-26 验收记录](docs/validation-2026-10-26.md)。
此前真实运行、评分修复、历史结果与费用限制见 [2026-10-23 全范围验收](docs/validation-2026-10-23.md)。

`pnpm run typecheck` 与 `pnpm test` 验证宿主类型，并用真实本地 CLI 固定各 Eval 读取的
`niceeval.query/v2` / `v3` 字段（当前结果、局部修复、沿用与判据失效），不调用付费模型。
历史对照结果保留，经当前宿主 CLI 读取。最新稳定版仍使用 Query v2，因此保留 v2/v3 的薄适配；不再维护更早版本的运行配置。

若旧 `.niceeval` 报 `record-schema-unsupported` 或旧 ProjectDatabase owner 未释放，保留完整
现场，按随包 `tutorials/agent-feedback-loop.mdx` 与 `troubleshooting/debugging.mdx` 在不含
`.niceeval` 的项目副本验证。不要删除锁或历史结果来绕过检查。静态计划通过不代表真实 OpenSandbox
或模型评估已通过；真实运行仍需明确成本授权。
