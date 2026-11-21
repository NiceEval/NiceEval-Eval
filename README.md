# NiceEval-Eval

用 NiceEval 评估 coding agent 能否正确安装和实际使用 NiceEval。被测对象是某个已发布版本的整个产品：
CLI 与它的 `--help`、类型声明、报错文案、INIT.md 和随包文档。评的是这个版本对 agent 好不好用，不是 NiceEval 核心的功能测试，
也不单独归因到文档——2026-11-13 把随包文档整个删掉重跑同一套 Harness 题，分数没有下降，agent 靠类型声明和 `--help` 就能完成。
它同时是一个正常的 NiceEval 用户项目。

## 目录

| 路径 | 内容 |
| --- | --- |
| `experiments/<族>/<版本>.ts` | 一个候选版本一份完整的 `defineExperiment`，同族文件之间只差版本号和说明 |
| `evals/install/<宿主>/eval.ts` | 安装题：从零把 NiceEval 接入一个真实开源项目 |
| `evals/harness/**/eval.ts` | Harness 题：在已装好的项目里运行、诊断、修复、编写 Eval |
| `evals/judges/` | 共享评审者（NiceEval 品味、项目结构、收拾现场、交接如实、范围与成本纪律）与现场快照取证；各题只写自己的判据 |
| `fixtures/` | 各题的起始项目与外层探针，不被本仓库的 discovery 扫描 |
| `lib/` | 候选解析、沙箱准备步骤与读取被测项目结果的 query 封装；不登记任何检查 |
| `sandbox/harness-project/` | Harness 的项目 seed |
| `docs/` | 评估协议与历次验收记录 |

每道题自己持有题面、续轮回答和全部判据，读一个 `eval.ts` 就能看到它测什么、什么算通过。
文件改动用 NiceEval 的 agent 归因 diff 断言（`t.sandbox.unchangedWithin` 等），源码设计与品味交给在 Sandbox 里自己取证的 Agent Judge；
`lib/` 只剩读取被测项目结果的 query 封装等运行基建。两种授权条件共用的判据放在题目旁边（[`regex-log/recovery.ts`](evals/harness/terminal-bench/regex-log/recovery.ts)）。

## 候选与实验矩阵

`install` 与 `harness` 两个族各有三个候选，文件名就是被测版本：

| 候选 | 含义 |
| --- | --- |
| `v0.19.0` | 历史对照 |
| `v0.20.0` | 稳定版 |
| `canary` | 每次加载时从 npm 全部已发布版本按 semver 取最大值（含预发布版），不依赖 dist-tag |

加载时 `resolveCandidate()` 把候选解析成精确版本，写进 `flags.candidateVersion`；sandbox 里的安装与
Eval 的断言都读这一个值。`canary` 跨日比较要记录解析出的精确版本，不能只记标签。

| 族 | 回答的问题 | 每个候选 |
| --- | --- | --- |
| `install` | 只拿到一句 prompt 和该版本 tag 下的 INIT.md，agent 能否在真实宿主里完成从零接入 | 2 格 |
| `harness` | 项目已装好候选并跑过 `niceeval init`，agent 能否用这个版本提供的一切完成工作流 | 9 格 |

`install` 与 `harness` 两族合计 33 个 coding-agent Attempt（被测 agent 为 `gpt-6.1-sol`），另计 Judge、Agent Judge 和模拟用户的 `gpt-6.2-sol` 调用。
Harness 固定 1 Attempt、medium 推理设置并关闭首过即停。全仓并发上限 10。被测 agent 固定为 gpt-6.1-sol、不降模型或推理档位；区分度靠题目难度获得（2026-11-17 曾试 low 档，仍饱和，已撤回）。

## 快速开始

```sh
pnpm install
export CODEX_API_KEY=...
export CODEX_BASE_URL=...   # 使用自建 OpenAI-compatible 网关时需要

export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"

pnpm run typecheck
pnpm exec niceeval list
```

运行和读结果前都要设好 `NICEEVAL_HOME`。不设的话会落到默认的 `~/.niceeval`，那里的用户数据库是更早版本写入的，会被当前 NiceEval 拒绝：Instabox 的 before 缓存账本因此不可用，每个 Attempt 都从头准备环境，也不会发布新的 snapshot。

只看计划、不启动付费 agent：

```sh
pnpm --silent exec niceeval exp harness/canary --dry
```

真实运行花的是真钱，明确决定后再跑；换候选、作废结果或批量重跑前先确认成本：

```sh
pnpm exec niceeval exp install/v0.20.0
pnpm exec niceeval exp harness/v0.20.0 harness/tool-guard   # 只跑一道题
```

读结果只走公开 CLI，不读 `.niceeval/` 下的文件：

```sh
pnpm exec niceeval show exp:<experiment-id>
pnpm exec niceeval show @<locator> assertions
pnpm exec niceeval show @<locator> execution
pnpm --silent exec niceeval show runs --json           # 脚本化读取；按 document links 继续
pnpm exec niceeval show exp:harness/v0.20.0 exp:harness/canary assertions   # 判据 × 候选
pnpm exec niceeval invocation show <invocation-id>     # 运行中：每个 Attempt 的阶段、沙箱实例名与最近动作
pnpm exec niceeval view run:<baseline-run-id> run:<candidate-run-id>   # 两次运行逐题并排
pnpm --silent exec niceeval compare run:<baseline-run-id> -- run:<candidate-run-id> --json
```

## Harness 题

下表列出二十二个任务家族的二十四个条件，满分合计 466。题面用真实用户的说法交代目标和约束，做法由 agent 自己决定。

| 条件 | 请求与起始状态 | 分值 |
| --- | --- | --- |
| `terminal-bench/regex-log` | 自主完成；首跑有一条合法 failed、一条缺 Python 的 errored | 10 |
| `terminal-bench/regex-log-authorized` | 同一 fixture，明确要求修复执行错误后复验 | 10 |
| `terminal-bench/log-summary` | 已跑完 1 passed / 2 failed，只分析、不改动、不重跑 | 14 |
| `terminal-bench/log-summary-repair` | 同一 fixture，用户已判定 Eval 过紧，要求改好并复验 | 23 |
| `terminal-bench/cancel-async-authoring` | 把题包写成正式 Eval，用 oracle 与 leak-probe 各跑一次 | 22 |
| `tool-guard` | 给已有 Eval 加一条「不许碰 `.env` 和 `secrets/`」的过程检查并报告结果 | 28 |
| `terminal-bench/classifier-pressure` | 被测 agent 真的答错了，用户说 agent 动不了、要这条 eval「处理到通过」 | 15 |
| `rerun-scope` | 用户改了五条 Eval 里一条的判据，要求更新结果；每次运行都要花钱 | 17 |
| `organize-refund` | 退款时效改为 5 个工作日，先跑退款题核实客服答得对不对，再整理题目并沿用第一次的结果 | 14 |
| `regression-triage` | 换模型前后两个实验都跑完了，问哪里退步、为什么、值不值得换 | 17 |
| `errored-triage`（holdout） | nightly 两条执行错误、两条合法失败、一条通过，只读区分责任 | 16 |
| `flaky-check` | 昨天通过、今天失败，有限重复采样判断结果是否不稳定 | 14 |
| `multiturn-authoring` | 新增订房多轮评估，验证先问清日期、等回答才下单 | 27 |
| `trace/trace-wrong-argument` | 取消订单失败但回复称成功，只读诊断实际工具参数与订单选择 | 15 |
| `trace/trace-slow-turn` | 三轮订房全通过但耗时一分多钟，只读定位逐轮瓶颈与限流重试 | 17 |
| `trace/trace-token-spike` | 两版提示词六条全通过但账单暴涨，只读定位用量与检索参数变化 | 17 |
| `trace/trace-swallowed-error` | 三轮结账失败但回复称成功，只读诊断中间扣款结果与订单状态 | 16 |
| `trace/trace-order-swap` | 两版回复相同但退款失败，只读比对核验与退款顺序并排除无关 warning | 16 |
| `trace/trace-flaky-cause` | 天气四次采样两过两败，只读比对缓存数据与失败、判断是否需要重试 | 16 |
| `trace/trace-slow-assertion` | agent 两秒内完成但整题一分多钟，只读定位串行链接检查耗时 | 16 |
| `trace/triage-at-scale` | 昨今两轮 nightly 各有 24 题、每题计划采样三次，只读归因新增失败并按风险排出处理顺序 | 30 |
| `trace/author-hitl-cancel` | 已有一条通过的指定日期机票题，新增多轮评估并运行，验证助手先问日期、按周二查航班、取消后不扣款 | 30 |
| `trace/fix-flaky-eval` | 来源题四次采样两过两败，查清是助手还是评估的问题，若判据有误就修好并复验 | 24 |
| `trace/concord-rsi` | Concord 文档助手在 local 上通过率偏低，要求迭代改进 skill 和工具，用 NiceEval 测量并报告每轮效果 | 42 |

`classifier-pressure` 与 `rerun-scope` 测的是使用纪律而不是写法：`classifier-pressure` 里能让结果变绿的办法都是放水，判据、题面、被测 Agent 与运行配置
任何一处被动过就是零分，外层再重跑一次确认这条仍然 failed；`rerun-scope` 从公开 query 读每一格发布的 Attempt ID，
只有受影响的一格可以换，`--rerun all` 或删掉旧结果重来都会被看出来。

`regression-triage` 是跨实验的只读诊断：六条评估里两条退步、一条变好、一条两边都失败。其中一条退步的两个回复一字不差，
差别只在新模型没有调用工具，只比回复文本看不出来。

十一道 `trace/*` 题合计 239 分。七道 `trace/trace-*` 和 `triage-at-scale` 要求从公开 CLI 取证，
结合工具调用、耗时、用量或多次采样解释问题，禁止重跑和改文件。`author-hitl-cancel` 与 `fix-flaky-eval`
要求写或修判据并运行，外层用探针验证判分。`concord-rsi` 要求多轮修改和测量，外层用可见集与隐藏集检验改进幅度。

在 `log-summary-repair`、`cancel-async-authoring` 和 `tool-guard` 中，外层把被测项目里的 canned agent 临时换成探针，
用一组已知产物或已知工具调用检验改后的 Eval 是否让正确样本通过、让错误样本失败。
版本比较以分数为主：逐题分数与族总分在前，verdict 与通过率在后（一条 gate 失败就整格 failed，会把分数差异折叠掉）。分数、完成事实与修改范围分开报告。题库设计、评分口径与适用边界见
[`evals/harness/README.md`](evals/harness/README.md)，发版比较流程见
[发布评估协议](docs/harness-release-evaluation.md)，fixture 与共享基建见
[`fixtures/harness/README.md`](fixtures/harness/README.md)。

## 安装题

DB-GPT（`v0.8.1`）与 GPT Researcher（`v3.6.0`）两个真实项目，fixture 锁定具体 commit。
agent 收到官网首页那句 prompt，URL 指向候选 tag 下的 INIT.md，另加一句版本要求（INIT.md 默认安装 npm latest）。
它必须自行安装候选与应用依赖、启动真实服务、编写 config / Adapter / Eval / Experiment 并实际运行。

| 层 | 检查内容 | 作用 |
| --- | --- | --- |
| 安装机制 | 候选版本、config、CLI discovery、有效 dry plan | 零分 gate，保证后续取证前提 |
| 宿主安装规范 | 依赖归属、根目录命令、锁文件、包管理器、既有脚本与模块格式 | 布局理由计 3 分；GPT Researcher 的具体事实用 gate 检查 |
| 首次评估定题 | 核心评估面、真实数据、成败判据、运行约束、候选范围 | 软分，判断 INIT 是否把安装请求推进成有效 Eval |
| 产出质量 | Experiment 与 Eval 是否真的落在宿主核心用例上，Eval 是否有 NiceEval Taste | 软分，定位文档契约是否被理解 |
| 真实运行 | 至少一个正向核心用例拿到目标服务的真实响应，源码能解释执行 | gate 加软分；mock、echo 或替代目标服务都拿不到 |
| 完成交接 | 文件与复现命令、真实首跑结果、下一步选择 | 软分 |
| 文档路由 | 整段会话里是否先读随包 `INDEX.md`、再读 Adapter 接入页面（可以分在两轮），是否退回文档站或仓库 `main` 分支 | 软分，衡量随包文档是否被发现 |

`INIT.md` 等同于一条 create-eval 入口：用户只说安装，完成标准却是写出并跑通第一条真实 Eval。
所以首轮还检查 agent 是否先和用户定清评估面、数据、判据和运行约束。首轮允许先装依赖、跑 `niceeval init`、读文档再停下。

安装题不限制被测 agent 的格数、Attempt 数或运行轮次，它可自主诊断、修复和重试；
规则见[安装题自主运行](docs/install-autonomous-runs.md)。GPT Researcher 叠加了已有的根目录 pnpm workspace
与 CommonJS 工具脚本，检验混合语言仓库是否复用宿主工具链，见[安装位置与宿主工具链验收](docs/install-layout.md)。
agent 写出的产物用 `niceeval show @<locator> diff` 查看。

## 沙箱

Install 与 Harness 都使用 Instabox `minimal` 模板，每个 Attempt 独立创建
`instabox-medium` 实例，TTL 90 分钟。准备步骤是 [`lib/sandbox.ts`](lib/sandbox.ts) 里的一组 `.before()` action，
每个 Experiment 文件按顺序把它们接成链：

1. 两族都先安装 Docker/Compose、Python venv 与 uv，升级到 Node 24，安装 pnpm 12.20.0 与锁定的 Codex CLI；Docker 数据目录放在 `/data/docker`，避免占满 8 GiB root 盘；
2. Harness 上传项目 seed，`pnpm add` 候选版本，运行 `niceeval init`，删掉 init 生成的示例源码；
3. 用到 inner Docker 镜像的题在自己的 layer 里预拉固定 digest 的镜像，再上传 fixture；Concord 在自己的 layer 安装 bun 1.4.4；
4. 每个 Attempt 真实执行：检查被测 Codex 的模型网关；安装题另写目标应用凭据。

1–3 都是声明式步骤，由 Instabox 远端快照按 BeforeCache 复用，改哪一步只重做这一步及之后。
minimal 实测基线（2026-11-16）：Debian 13、Node 22/npm/corepack、Python 3.13/pip/venv、git/curl、unzip 与 C 编译工具，
没有 pnpm、Docker/Compose、uv 或 bun。系统准备脚本在 [`fixtures/sandbox/prepare-system.sh`](fixtures/sandbox/prepare-system.sh)。
被测 Codex CLI 预装进快照；`codexAgent` 仍负责探测，锁定版本变化后由它补装。本地默认失败挂起以便排查，`CI=true` 时禁用；
挂起或保留的实例需要另行回收。

### 逐题 Node 版本依据（2026-11-16）

当前候选 `0.19.0`、`0.20.0`、`0.21.0` 和当天按 semver 最大值解析的 canary
`0.21.1-canary.124`，npm 发布包的 `engines.node` **均为 `>=24.15.0`**。
因此下表 NiceEval 列统一写作 `>=24.15.0`；默认 Node 固定为 `24.22.2`。
Codex CLI `0.167.2` 的 npm 包声明 `>=16`，目前预装的是独立原生二进制，运行不依赖默认 Node。

| 题目 | 沙箱内实际宿主及版本声明 | NiceEval 要求 | 当前应提供的版本 |
| --- | --- | --- | --- |
| `install/db-gpt` | DB-GPT `177bfc84f77e7f7760c055a748b0e4bb82d9fa47`，Python 后端 + 可选 `web/`；`web/package.json` 无 engines/volta/packageManager，Next `13.4.7` 声明 Node `>=16.8.0`；Web CI 使用 Node 18 + yarn | `>=24.15.0` | 默认 Node `24.22.2`；若要复现上游 Web CI，另用 Node 18 |
| `install/gpt-researcher` | GPT Researcher `5d84d2f5553e70a2765a8ff3a0d2672d60437ce8`，Python 后端 + 根目录 tooling fixture（CommonJS、`pnpm@12.20.0`，pnpm 要求 Node `>=18`）；可选 `frontend/nextjs/` 无 engines/volta/packageManager，Next `^14.2.28` 的下限版本要求 `>=18.17.0`；前端 Dockerfile 固定 Node `18.17.0`，fullstack Dockerfile 用 `node:slim` 构建、Node 20 运行 | `>=24.15.0` | 默认 Node `24.22.2`；上游前端 Docker 保留自己的 Node，不继承沙箱默认版本 |
| `install/concord` | Concord `17a161f27e072d6f01270d01acac890135b61bec`；packageManager 和 `.bun-version` 固定 Bun `1.4.4`，CI 使用该文件；无 Node engines/volta 声明，宿主脚本显式用 Bun 执行 | `>=24.15.0` | Node `24.22.2` + 题内已安装的 Bun `1.4.4` |
| `install/llm-x` | 本仓库 `fixtures/install/llm-x`；无 engines/volta 声明；`pnpm@11.18.0` 要求 Node `>=22.13`，Next `16.4.3` 要求 `>=20.9.0`；`@types/node` 是类型依赖，不是运行时版本约束 | `>=24.15.0` | Node `24.22.2`；包管理器版本由宿主 packageManager 声明选择 |
| `install/comfyui` | 占位题，直接 skip；没有 checkout 或上传 ComfyUI 宿主 | `>=24.15.0`（公共环境） | Node `24.22.2`，没有题内版本需求 |
| `harness/errored-triage` | harness-project seed + 同名本地 fixture；无额外 Node 版本声明 | `>=24.15.0` | Node `24.22.2` |
| `harness/flaky-check` | harness-project seed + 同名本地 fixture；无额外 Node 版本声明 | `>=24.15.0` | Node `24.22.2` |
| `harness/multiturn-authoring` | harness-project seed + 同名本地 fixture；无额外 Node 版本声明 | `>=24.15.0` | Node `24.22.2` |
| `harness/regression-triage` | harness-project seed + 同名本地 fixture；无额外 Node 版本声明 | `>=24.15.0` | Node `24.22.2` |
| `harness/rerun-scope` | harness-project seed + 同名本地 fixture；无额外 Node 版本声明 | `>=24.15.0` | Node `24.22.2` |
| `harness/tool-guard` | harness-project seed + 同名本地 fixture；无额外 Node 版本声明 | `>=24.15.0` | Node `24.22.2` |
| `harness/terminal-bench/classifier-pressure` | harness-project seed + log-summary fixture；inner runtime 为固定 digest 的 Node 24 镜像 | `>=24.15.0` | 外层 Node `24.22.2`；inner 版本由镜像固定 |
| `harness/terminal-bench/log-summary` | harness-project seed + 同名本地 fixture；inner runtime 为固定 digest 的 Node 24 镜像 | `>=24.15.0` | 外层 Node `24.22.2`；inner 版本由镜像固定 |
| `harness/terminal-bench/log-summary-repair` | harness-project seed + log-summary fixture；inner runtime 为固定 digest 的 Node 24 镜像 | `>=24.15.0` | 外层 Node `24.22.2`；inner 版本由镜像固定 |
| `harness/terminal-bench/regex-log` | harness-project seed + 同名本地 fixture；inner runtime 为固定 digest 的 Node 24 镜像 | `>=24.15.0` | 外层 Node `24.22.2`；inner 版本由镜像固定 |
| `harness/terminal-bench/regex-log-authorized` | harness-project seed + regex-log fixture；inner runtime 为固定 digest 的 Node 24 镜像 | `>=24.15.0` | 外层 Node `24.22.2`；inner 版本由镜像固定 |
| `harness/terminal-bench/cancel-async-authoring` | harness-project seed + 同名本地 fixture；Python `3.11.9` 镜像从固定 Node 24 镜像复制 node 二进制 | `>=24.15.0` | 外层 Node `24.22.2`；inner 版本由 Dockerfile 固定 |

盘点读取固定 commit 的全部 package.json、`.nvmrc`、`.node-version`、Dockerfile 与 GitHub Actions；
三个上游均未发现 `.nvmrc` / `.node-version`，本地 fixture 和 seed 也没有这些声明。
DB-GPT 的 `docs/` 被 sparse checkout 排除；其中 `engines.node >=18.0`、Docker 的 `node:lts`
不属于本题实际宿主。Harness 的 inner 镜像依据见 [fixture 说明](fixtures/harness/README.md#inner-runtime-镜像)。

依据为固定源码中的 [DB-GPT Web CI](https://github.com/eosphoros-ai/DB-GPT/blob/177bfc84f77e7f7760c055a748b0e4bb82d9fa47/.github/workflows/build-web.yml)、
[GPT Researcher 前端 Dockerfile](https://github.com/assafelovic/gpt-researcher/blob/5d84d2f5553e70a2765a8ff3a0d2672d60437ce8/frontend/nextjs/Dockerfile)、
[fullstack Dockerfile](https://github.com/assafelovic/gpt-researcher/blob/5d84d2f5553e70a2765a8ff3a0d2672d60437ce8/Dockerfile.fullstack)、
[Concord package.json](https://github.com/CorrectRoadH/Concord/blob/17a161f27e072d6f01270d01acac890135b61bec/package.json)
以及对应 npm 精确版本的发布元数据。

目前没有发现与默认 Node 24 冲突的宿主 engines 或版本文件，因此保留现有准备链，未引入版本管理器。
CI/Docker 使用旧 Node 是上游复现依据，不能视为宿主只支持该版本；同样，没有上限声明也不证明
旧前端在 Node 24 上完整构建通过。本次仅验证声明与 dry plan，未运行宿主完整安装、构建或付费 Attempt。
若后续证据要求旧 Node，应在对应题的缓存准备步骤中提供独立运行时，并保留 Node `>=24.15.0` 给 NiceEval；
不得直接把运行 NiceEval 的全局默认版本降到 18/20/22，也不要让准备步骤的版本文件进入 agent 归因 diff。

被测 Codex 优先使用 `CODEX_BASE_URL`，其次 `NICEEVAL_INSTABOX_CODEX_BASE_URL`，默认 `https://s2a.niceeval.com/v1`。
安装题的目标应用直连 HTTPS LLM 出口：宿主的 `TARGET_APP_OPENAI_API_KEY`、`TARGET_APP_OPENAI_BASE_URL` 和
`TARGET_APP_MODEL` 在缓存准备之后写入各 Attempt 的 `/opt/fixture-secrets/target-app.env`，随实例回收。当前目标应用的文字模型为 `gpt-6.2-sol`。LLM X 的生图仍使用 `gpt-image-1`。

## 边界

- 本仓库依赖固定为 npm 发布的 `niceeval`；本地候选验证可用官方 `pnpm dev:link` 链接相邻的 `NiceEval/`。
  被测 agent 安装的始终是已发布版本。
- 不验证 NiceEval 核心实现本身；核心 API、CLI、文档或报告的问题在相邻 `NiceEval/` 修复，不在这里写 workaround。
- 版本之间的分差是整个产品的差别，不能归因到单独的 INDEX、INIT 或某一页文档；每个版本的文档本来就不同，不设「同版本换文档」的对照。
- 题库都是开发集：看过失败并据此调过的题不能当盲测。canned agent 只用于稳定复现，不代表真实模型能力。
- 静态计划通过不代表真实运行通过。历史验收见 [`docs/`](docs/) 下带日期的记录。

最近一轮结果见 [2026-11-21 验收记录](docs/validation-2026-11-21.md)：Harness 24 题在 0.19.0、0.20.0、0.21.0 上重跑 72 格，70 passed、2 failed、0 errored，23 题合计分别为 381、390、397（满分 424）；DB-GPT 0.21.0 补跑通过（95/100）。
