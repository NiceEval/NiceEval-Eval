# NiceEval-Eval

用 NiceEval 评估 coding agent 能否正确安装和实际使用 NiceEval。被测对象是「某个版本的 NiceEval 加它随包发布的文档」，
评的是 INIT.md、随包 `INDEX.md` 与文档页对 agent 的实际效果，不是 NiceEval 核心的功能测试。
它同时是一个正常的 NiceEval 用户项目。

## 目录

| 路径 | 内容 |
| --- | --- |
| `experiments/<族>/<版本>.ts` | 一行一个候选版本；族的定义在 [`lib/experiments.ts`](lib/experiments.ts) |
| `evals/install/<宿主>/eval.ts` | 安装题：从零把 NiceEval 接入一个真实开源项目 |
| `evals/harness/**/eval.ts` | Harness 题：在已装好的项目里运行、诊断、修复、编写 Eval |
| `fixtures/` | 各题的起始项目与外层探针，不被本仓库的 discovery 扫描 |
| `lib/` | 取证探针、候选解析与沙箱准备；不登记任何检查。`lib/probes/` 是在被测 sandbox 里执行的取证脚本 |
| `sandbox/` | Harness 的项目 seed 与沙箱准备脚本（`sandbox/scripts/*.sh`） |
| `tests/` | 用真实本地 CLI 固定判据读取的字段与 fixture 契约，不调用模型 |
| `scripts/harness-report.ts` | 把指定 Run 的 Harness 观察值汇成 JSON |
| `docs/` | 评估协议与历次验收记录 |

每道题自己持有题面、续轮回答和全部判据，读一个 `eval.ts` 就能看到它测什么、什么算通过。
`lib/` 只负责「一条命令或一个文件」的取证；多道题确实相同的判据放在题目旁边
（[`evals/install/taste.ts`](evals/install/taste.ts)、[`regex-log/recovery.ts`](evals/harness/terminal-bench/regex-log/recovery.ts)）。

## 候选与实验矩阵

`install` 与 `harness` 两个族各有三个候选，文件名就是被测版本：

| 候选 | 含义 |
| --- | --- |
| `v0.19.0` | 历史对照 |
| `v0.20.0` | 稳定版 |
| `canary` | 每次加载时从 npm 全部已发布版本按 semver 取最大值（含预发布版），不依赖 dist-tag |

加载时 `ensureCandidate()` 把候选解析成精确版本，写进 `flags.candidateVersion`；sandbox 里的安装、
Eval 的断言与文档页校验都读这一个值。`canary` 跨日比较要记录解析出的精确版本，不能只记标签。

| 族 | 回答的问题 | 每个候选 |
| --- | --- | --- |
| `install` | 只拿到一句 prompt 和该版本 tag 下的 INIT.md，agent 能否在真实宿主里完成从零接入 | 2 格 |
| `harness` | 项目已装好候选并跑过 `niceeval init`，agent 能否只靠随包文档完成工作流 | 6 格 |
| `harness-nodocs` | 同一套 Harness 题，随包文档与 init 指引块被删掉，agent 只剩类型声明、源码与 `--help` | 6 格，目前只有 `v0.20.0` |

`harness-nodocs` 是文档消融对照：与同版本 `harness` 的分差才是文档的贡献，跨版本比较里混着代码与 CLI 的变化。
哪道题删了文档分数不变，说明它测的是模型本身，不能用来评文档。

`install` 与 `harness` 两族合计 24 个 coding-agent Attempt（被测 agent 为 `gpt-6.1-sol`），另计 Judge（`gpt-6-astra`）调用。
Harness 固定 1 Attempt、medium 推理设置并关闭首过即停。全仓并发上限 10。

## 快速开始

```sh
pnpm install
export CODEX_API_KEY=...
export CODEX_BASE_URL=...   # 使用自建 OpenAI-compatible 网关时需要

pnpm run typecheck
pnpm test
pnpm exec niceeval list
```

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
pnpm exec niceeval show --experiment <experiment-id>
pnpm exec niceeval show @<locator> --assertions
pnpm exec niceeval show @<locator> --execution
pnpm exec niceeval show --experiment harness/v0.20.0 --experiment harness/canary --assertions   # 判据 × 候选
pnpm exec niceeval invocation show <invocation-id>     # 运行中：每个 Attempt 的阶段、沙箱实例名与最近动作
pnpm harness-report <run-id> [<run-id> ...]
```

## Harness 题

四个任务家族、六个条件，满分合计 99。题面用真实用户的说法，只说要什么；做法由随包文档和 agent 自己补上。

| 条件 | 请求与起始状态 | 分值 |
| --- | --- | --- |
| `terminal-bench/regex-log` | 自主完成；首跑有一条合法 failed、一条缺 Python 的 errored | 10 |
| `terminal-bench/regex-log-authorized` | 同一 fixture，明确要求修复执行错误后复验 | 10 |
| `terminal-bench/log-summary` | 已跑完 1 passed / 2 failed，只分析、不改动、不重跑 | 14 |
| `terminal-bench/log-summary-repair` | 同一 fixture，用户已判定 Eval 过紧，要求改好并复验 | 23 |
| `terminal-bench/cancel-async-authoring` | 把题包写成正式 Eval，用 oracle 与 leak-probe 各跑一次 | 18 |
| `tool-guard` | 给已有 Eval 加一条「不许碰 `.env` 和 `secrets/`」的过程检查并报告结果 | 24 |

后三道 authoring 题不相信 agent 自己的运行：外层把被测项目里的 canned agent 临时换成探针，
用一组已知产物或已知工具调用检验改后的 Eval，既不能过紧也不能放水。
分数、完成事实与修改范围分开报告。题库设计、评分口径与适用边界见
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
agent 写出的产物会复制到 gitignored 的 `.agent-output/` 供人工复核。

## 沙箱

Install 与 Harness 都使用 Instabox `universal` 模板，每个 Attempt 独立创建 `instabox-medium` 实例，TTL 90 分钟。
连接凭据由宿主提供。[`lib/experiment-runtime.ts`](lib/experiment-runtime.ts) 声明全部准备步骤，脚本正文在 [`sandbox/scripts/`](sandbox/scripts/)：

1. 安装 Node / pnpm / Codex，从固定 digest 准备 inner Docker runtime 并冒烟；
2. Harness 另行上传项目 seed，按候选版本安装 NiceEval、运行 `niceeval init` 并物化只读依赖树；
3. 每个 Attempt 检查运行契约（Node、pnpm、Docker、Compose、候选版本），再由各题上传自己的 fixture。

前两步通过 Instabox 远端快照按 BeforeCache 复用。本地默认失败挂起以便排查，`CI=true` 时禁用；
挂起或保留的实例需要另行回收。

被测 Codex 优先使用 `CODEX_BASE_URL`，其次 `NICEEVAL_INSTABOX_CODEX_BASE_URL`，默认 `https://s2a.niceeval.com/v1`。
安装题的目标应用直连 HTTPS LLM 出口：宿主的 `TARGET_APP_OPENAI_API_KEY`、`TARGET_APP_OPENAI_BASE_URL` 和
`TARGET_APP_MODEL` 在缓存准备之后写入各 Attempt 的 `/opt/fixture-secrets/target-app.env`，随实例回收。

## 边界

- 本仓库依赖固定为 npm 发布的 `niceeval`；本地候选验证可用官方 `pnpm dev:link` 链接相邻的 `NiceEval/`。
  被测 agent 安装的始终是已发布版本。
- 不验证 NiceEval 核心实现本身；核心 API、CLI、文档或报告的问题在相邻 `NiceEval/` 修复，不在这里写 workaround。
- 完整产品版本对比不能归因到单独的 INDEX 或 INIT。`harness-nodocs` 只回答「有没有文档」的差别；换成另一份文档快照的因果实验不支持。
- 题库都是开发集：看过失败并据此调过的题不能当盲测。canned agent 只用于稳定复现，不代表真实模型能力。
- 静态计划通过不代表真实运行通过。历史验收见 [`docs/`](docs/) 下带日期的记录。
