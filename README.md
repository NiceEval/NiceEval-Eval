# NiceEval-Eval

用 NiceEval 评估 coding agent 是否能正确安装、迁移和实际使用 NiceEval。这里评的是
NiceEval 的文档链与用户工作流，不是 NiceEval 核心的功能测试。

主仓库当前消费 `niceeval@^0.12.0`。工作区开发时，`pnpm-workspace.yaml` 会把宿主 CLI
链接到相邻的 `../NiceEval` 源码；进入 E2B sandbox 的被测候选仍按明确版本从 npm 安装，
避免把宿主工具与被评版本混为一件事。

## 评估分区

`evals/` 按用户所处阶段分成四组：

| 目录 | 类型 | 回答的问题 | 当前场景 |
| --- | --- | --- | --- |
| `install/` | 安装评估 | 从零开始，agent 能否在真实项目中安装候选版本并写出可用的 config、adapter、eval 和 experiment | DB-GPT、GPT Researcher |
| `advance/` | 高级安装评估 | 遇到复杂运行环境和第三方 agent 时，能否选择合适的接入层与 sandbox | Express coding-agent Sandbox、Letta、OpenHands、Skyvern |
| `experiment/` | 实验评估 | 已经接入后，agent 能否运行、读结果、调试、自迭代，以及跨版本迁移 | 原样跑通、必失败后修复、0.9.1 → 0.12.0 长程迁移 |
| `debug/` | 历史诊断评估 | 面对已落盘的真实结果，agent 能否只通过 CLI 找到指定证据 | 有/无 `niceeval init` 指引的对照组 |

`install/` 和 `advance/` 都属于“把 NiceEval 装进去”，区别是前者覆盖常见真实项目，
后者专门保留复杂 provider、sandbox 与框架集成路径。`experiment/` 不再重复考安装产物质量，
而是考 NiceEval 已存在时的反馈闭环。

## experiment/ 的三个确定性场景

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
pnpm --silent exec niceeval exp experiment/v0.12.0 --dry --json
pnpm --silent exec niceeval exp install/v0.12.0 --dry --json
pnpm --silent exec niceeval exp advance/v0.12.0-node --dry --json
pnpm --silent exec niceeval exp advance/v0.12.0-python --dry --json
```

明确决定花费后再运行实验：

```sh
pnpm run experiment-eval
pnpm run install-eval
pnpm run debug-eval
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

安装组当前有三格：

- `install/v0.12.0`：当前稳定发布基线；
- `install/v0.11.0`：上一代对照；
- `install/canary`：解析运行时的 canary dist-tag。

每个 experiment 都通过 `ensureCandidate()` 物化候选清单，并把解析后的精确版本放进
`flags.candidateVersion`。sandbox 中安装、断言和文档页校验都使用同一个版本值。

高级安装与操作实验目前以 `0.12.0` 为迁移基线，分别拆成 Node、Python sandbox 和
确定性的 Node 工作流，避免所有题共用一个不适合的环境。

`debug/` 是例外：它读取 NiceEval 0.4.6 产出的 schema 8 历史快照，reader 固定为最后验证过
兼容的 0.9.1。新版本的主动失败与修复由 `experiment/repair-failing` 覆盖，避免把“旧 schema
兼容性”混进“agent 会不会调试”的对照变量。

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

- `fixtures/projects/experiment-ready`：0.12.0 绿色项目。
- `fixtures/projects/experiment-failing`：0.12.0 确定性红色项目。
- `fixtures/projects/migration-0.9`：可在 0.9.1 运行的旧 API 项目。
- `fixtures/results/`：历史 debug 结果与人工核对题库，详情见
  [`fixtures/results/README.md`](fixtures/results/README.md)。

仓库不验证 NiceEval 核心实现本身；核心 API、CLI 或报告问题应在相邻 `NiceEval/` 修复。
这里也不自动跑全量或付费实验：更换候选、作废结果或批量重跑前必须先确认成本。
