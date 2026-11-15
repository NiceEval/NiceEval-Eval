# 2026-11 新增题：Concord 安装题与三道 Harness 题

0.21.0 的 Harness 是 154/156，DB-GPT 是 98/98，现有题快饱和了，而且全部是看过失败、调过判据的开发集。本轮新增四道题，在 NiceEval 下一个版本发布之前冻结，作为**保留题**：

| 题 | 家族 | 测什么 |
| --- | --- | --- |
| `install/concord` | 安装 | 在一个没有 AI 入口的工具仓库里，为「Codex 使用该工具的随包 docs/skill」建立评估题和对照实验 |
| `harness/errored-triage` | 只读诊断 | 区分执行错误（环境问题）和合法失败（产品问题），并给出各自的证据 |
| `harness/flaky-check` | 使用纪律 | 判断一条失败是真坏了还是时好时坏：只对这一条做有限次的重复采样，并用通过率下结论 |
| `harness/multiturn-authoring` | 写作 | 写一条多轮评估，要求先问清再下单、下单参数来自用户的回答；外层用探针检查它既不放水也不过紧 |

四道题都打 `holdout` 标签。**保留规则**：可以修正判据本身的误判（例如 Judge rubric 与事实矛盾、外层核验的 bug），但一旦根据这几道题的失败去改 NiceEval 的 docs，就把这道题移入开发集，并去掉 `holdout` 标签。

2026-11-15 根据 `install/concord`、`harness/flaky-check`、`harness/multiturn-authoring` 三道题的失败修改了 NiceEval 文档（NiceEval ff993bd6e），按保留规则将三题移入开发集并去掉 `holdout` 标签；`harness/errored-triage` 仍是保留题。

题目文件按现有题的写法各自完整复制，不抽公共模块（判据逐字重复是有意的）。新题不能改动 `lib/**` 或任何现有题文件，否则三个正式版已沿用的 33 格结果会因源码闭包变化而作废。需要的辅助代码直接写在新题自己的文件里。

## install/concord

### 场景

Concord（<https://github.com/CorrectRoadH/Concord>）是本地的 spec 驱动开发工具，有 CLI 和 Web 工作台，**没有 AI 入口**，核心流程不调用任何模型。它为 coding agent 随包提供指引：`concord init` 往项目里写入 skill 入口和 `AGENTS.md` 托管区块，`concord --skill <topic>` 按主题输出完整指引（spec、implement、review、fix、test、trace 等）。指引要求 agent：先改 Spec 再实现，代码和测试用 `@concord-*` 标记关联到 Use Case 或其步骤，交付前实际运行 `concord check` 并确认通过，领域术语使用 `concepts.md` 中定义的名字。

这道题的被测 agent 要在 Concord 仓库里装上 NiceEval，建立评估题和 Experiment，衡量**Concord 随包 docs/skill 能否让 Codex 按 Concord 流程开发**。它和本仓库评估 NiceEval 文档是同一种结构。它比 DB-GPT 和 GPT Researcher 深在三点：

- 需要先认清评估对象：Concord 没有可调用的 AI 入口，被测的是 Codex（用 NiceEval 内置的 `codex` Sandbox Agent），不应该给 Concord 写 Adapter。
- 需要设计对照实验：两组 Experiment 只差是否提供 Concord 随包指引，其余（Codex 模型、推理设置、任务、Concord 版本）都相同。
- 需要在 Sandbox 里给 Codex 准备一个受 Concord 管理的真实工作区，并用确定性检查（命令退出码、文件内容、diff）判断 Codex 有没有按流程做。

### 起始状态

- 题目文件：`evals/install/concord/eval.ts`。复制 `evals/install/gpt-researcher/eval.ts` 后改写；不新增 fixture 叠加层。
- checkout：`https://github.com/CorrectRoadH/Concord.git`，固定 ref `17a161f27e072d6f01270d01acac890135b61bec`（当前 `origin/master`）。和 DB-GPT 一样删掉上游 `.git`，重建只有一次 baseline 提交的仓库，供评审用 `git status` 和 `git diff` 查看改动。
- Concord 仓库自己就受 Concord 管理（根目录有 `concord.config.ts`、`docs/`、`AGENTS.md`），包管理器是 bun（`packageManager: bun@1.4.4`，`bun.lock`）。
- 首条消息与其它安装题完全相同，不说要评什么：

  ```
  READ <候选 tag 下的 INIT.md URL> and install niceeval for this repo.
  Use niceeval@<version> exactly.
  ```

- `timeoutMs`：85 分钟。安装实验共用的 Instabox 实例寿命是 90 分钟（`lib/sandbox.ts`），实例寿命必须覆盖 Attempt 截止时间再加 30 秒；改共享寿命会让全部现有格作废，所以题目超时服从它。
- Sandbox before 链：沿用 install 实验已有的 `targetAppSecretsDir`、`agentEndpointCheck`、`targetAppEnv`（由 experiment 提供，题目文件不改它们）。题目自己的 before 只做 checkout 和重建 git。

### 模拟用户（维护者已经拿定的决定）

模拟用户只回答被问到的事；没决定过的，让 agent 依据仓库和随包文档自己判断。它已经决定：

- 要评估的是 Concord 随包的 docs 和 skill：装了 Concord 并按它的指引工作的 Codex，是否比没有指引的 Codex 更能按 Concord 流程开发。Concord 本身没有 AI 入口，不需要也不应该为 Concord 写 Adapter。
- 被测 Codex 用 NiceEval 内置的 Codex Sandbox Agent。模型和凭据都在 `/opt/fixture-secrets/target-app.env`：`OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `TARGET_APP_MODEL`。凭据只能在运行时注入 Sandbox，不得输出，也不得复制进工作区或提交。
- 这台机器有 Docker，可以联网拉取镜像、按 Concord 官方方式安装 Concord，也可以从源码构建。
- 维护者最关心三件事：Codex 改行为时是否先改 Spec，测试和代码是否关联到 Use Case，交付前是否跑通 `concord check`。
- 选 Tier 1，首跑不接 OTel/OTLP。没有可用的 Judge key。
- 可以自主运行、诊断、修复和重试，不限制格数、Attempt 数和轮次，无需再申请运行授权；实际成本计入评估。

### 评分

结构照抄 gpt-researcher：先评源码，安装或运行失败不会抹掉源码证据；gate 用确定性检查；首轮理解和设计质量交给 Judge 或 Agent Judge。下面的分值是设计值，实现时可以按实测事实调整措辞，但不能把 gate 降为计分项，也不能删项。

**gate（确定性检查，外层在交接后执行）**

1. 根目录 `package.json` 把 `niceeval` 精确声明为候选版本的 devDependency。
2. 保留 bun：`packageManager` 字段不变；不新增 `pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`；不在子目录另建带锁文件的 Node 项目。根目录 `bun.lock` 可以更新。
3. 根目录 `bun install --frozen-lockfile` 成功。
4. 从根目录执行候选 CLI（`node_modules/.bin/niceeval`）：`--version` 等于候选版本，`list` 成功并发现至少 1 条 Eval 和至少 2 个 Experiment，`exp --dry --json` 返回非空 matrix。
5. Concord 原有的检查仍然通过：根目录 `bun run typecheck` 和 Concord 自身的 `concord check`（用仓库内的 `bun run concord check`）都成功。实现前先确认 baseline 状态下这两条在 Sandbox 里都能通过；某一条在 baseline 上就不能通过时，去掉该条并在报告里写明证据。
6. Experiment 使用 NiceEval 内置的 codex Agent：新增或修改的文件里没有 `defineAgent(`，并且每个 Experiment 的 adapter 来自 NiceEval 内置的 codex 入口（具体导入路径按候选随包文档核实）。
7. 真实运行：公开 `run.list` 非空；`project.get` 中每个当前 member 都发布了 Attempt；至少两个不同的 Experiment 各有一个已发布、实际执行的 Attempt，并且其 execution 显示 Codex 运行过命令或改过文件。读取方式照抄 gpt-researcher 的 `currentAttempts` 加 overview/execution。
8. 凭据不进仓库：工作区文件和 `git diff` 中不出现 `OPENAI_API_KEY` 的实际值。

**首轮理解（Judge，只看首轮对话和首轮写下的说明文件，复用 `firstTurnWrittenNotes`）**

| 项 | 分 | 事实 |
| --- | --- | --- |
| 认清评估对象 | 2 | 说明 Concord 是没有 AI 入口的开发工具，被测的是 Codex 在 Concord 随包指引下的开发行为；打算给 Concord 写 HTTP/CLI Adapter 的，不算 |
| 核对 Concord 指引的要求 | 2 | 至少说出三项：先改 Spec 再实现；代码和测试用 Concord 标记关联 Use Case；交付前运行 `concord check`；术语遵循 `concepts.md`。并且本轮命令能看到它读过 Concord 的 skill 或 `--skill` 输出 |
| 提出核心用例 | 2 | 提出至少一个具体任务：在受 Concord 管理的项目里改一个行为或修一个缺陷，并说明怎么判定 Codex 是否按流程完成 |
| 询问 Judge | 1 | 同 gpt-researcher |
| 询问首跑预算 | 1 | 同 gpt-researcher |
| 首轮停下等用户决定 | 1 | 同 gpt-researcher |

**实验设计（Agent Judge，自己读文件和运行命令取证）**

| 项 | 分 | 事实 |
| --- | --- | --- |
| 对照只差随包指引 | 3 | 至少一组基线和一组处理 Experiment：两组的 Codex 模型、推理设置、Eval 集合和 Concord 版本相同，唯一差别是是否提供 Concord 随包 skill/AGENTS 指引 |
| Concord 版本固定 | 1 | Sandbox 里装的 Concord 是固定版本或固定提交，不是“最新” |
| 凭据运行时注入 | 2 | 内层 Codex 的 key、base URL 和模型从 env 文件在运行时读取，没有写死在源码里 |

**评估题质量（Agent Judge）**

| 项 | 分 | 事实 |
| --- | --- | --- |
| 工作区真实 | 2 | Codex 拿到的是受 Concord 管理的项目（有 Feature、Use Case、`concepts.md` 或等价结构），任务是改行为或修缺陷，不是问答 |
| 确定性检查流程结果 | 3 | 用命令退出码和文件内容检查 `concord check`、项目测试、Use Case 文件改动和测试标记，而不是只看 Codex 的回复 |
| 判据能区分 | 3 | 至少一项判据在 Codex 跳过 Spec、直接改代码时会失败（例如要求对应 Use Case 文件有改动，且新测试带指向它的 Concord 标记） |
| 覆盖不同流程 | 2 | 至少两个任务覆盖不同的 Concord 流程，例如新增行为与修复缺陷 |
| 判据平铺在打分处 | 1 | 同 tool-guard 品味项 |
| 未知保持未知 | 1 | 同 tool-guard 品味项 |

**交接（Judge）**

| 项 | 分 | 事实 |
| --- | --- | --- |
| 交接引用 locator 并如实报告 | 3 | 同 gpt-researcher |
| 对比结论有节制 | 2 | 报告基线与处理两组的结果差异时写明样本量；单次 Attempt 的差异不说成因果结论 |

设计合计：gate 8 道，计分 32 分（首轮 9 + 实验设计 6 + 评估题质量 12 + 交接 5）。

### 环境由我们配置

题目跑在 Instabox 上，外层 Sandbox 和题内环境都由本仓库配置。下面几项是实现时要配好的环境，不是停止条件；哪条路线不通就换一条，并把最终选择和证据写进报告。只有凭据或权限确实无法取得时，才停下报告。

1. **内层 Codex 的模型端点**：Codex 走 Responses API。先从宿主用最小的 `/responses` 请求确认 `TARGET_APP_OPENAI_BASE_URL` 加 `TARGET_APP_MODEL` 是否可用（不打印 key）。不可用时，改为给内层 Codex 提供可用的端点：外层 Codex 用的网关已经支持 Responses。在题目自己的 before 里把对应凭据写进 `/opt/fixture-secrets/` 下的文件，并相应改写模拟用户的说明。凭据不进缓存，也不进工作区。
2. **Docker 与 Concord 的安装**：外层 Instabox 实例里需要什么（Docker、bun、Concord 的固定版本、内层镜像）就在题目自己的 before 链里准备，可以预拉镜像、预装工具。内层镜像不满足 Concord 的 glibc ≥ 2.39 要求时，换镜像，或者改用 Nix、源码构建等路线。目标是让被测 agent 面对的是装得上的环境；装 Concord、配内层 Sandbox 仍然是被测 agent 自己的事。
3. **baseline 检查**：在固定 ref 的全新 checkout 上确认 `bun install --frozen-lockfile`、`bun run typecheck`、`bun run concord check` 的结果（对应 gate 3 和 gate 5）。缺 bun 就在 before 里装上。

before 步骤写在 `evals/install/concord/eval.ts` 里，不改 `lib/**`，也不改 experiments。

## harness/errored-triage

**起始项目** `fixtures/harness/errored-triage/repo/`：一个研究助手的 canned agent，加实验 `nightly`、5 条评估 `evals/nightly/*.eval.ts`。外层先跑一次 `nightly`，并核对起始 verdict 与下表一致；不一致就抛错，不判分（照抄 regression-triage）。

| 评估 | 起始 | 原因（只能从公开结果里读到） |
| --- | --- | --- |
| `nightly/web-search` | errored | Adapter 抛出 `SEARCH_API_KEY is not set`：跑测环境缺 key |
| `nightly/export-pdf` | errored | Adapter 连接本地渲染服务失败：`connect ECONNREFUSED 127.0.0.1:6379` |
| `nightly/summarize` | failed | 摘要漏掉了要求的营收数字 `4.2M` |
| `nightly/cite-sources` | failed | 回复引用了来源列表之外的 URL |
| `nightly/translate` | passed | — |

两条 errored 必须是 NiceEval 判为执行错误（errored）的结果，而不是 ordinary failed。实现时在 0.19.0、0.20.0 和 0.21.0 三个候选上确认分类一致，必要时调整 fixture 的写法（以现有 fixture 跨版本兼容的写法为准）。

**题面**：「昨晚 nightly 挂了好几条。帮我分一下：哪些是助手本身的问题要交给模型组，哪些是跑测环境的问题要交给平台组，每条说说依据。只看，不要改，也不要重跑。」

**评分**（照抄 regression-triage 的结构）：

| 项 | 分 | 方式 |
| --- | --- | --- |
| 没有重跑：没有新发布的 Run | 2 | 外层 run.list 前后比较 |
| 项目文件保持不变 | 1 | `noChanges` |
| 分组恰好正确 | 4 | Judge：模型组恰好是 summarize 和 cite-sources，平台组恰好是 web-search 和 export-pdf；translate 不算问题 |
| web-search 的依据 | 2 | Judge：指出缺 `SEARCH_API_KEY` |
| export-pdf 的依据 | 2 | Judge：指出连接 6379 端口被拒绝，即依赖的服务没起来 |
| summarize 的原因 | 2 | Judge：指出漏了营收数字 4.2M |
| cite-sources 的原因 | 2 | Judge：指出引用了来源列表之外的 URL |
| 说明 errored 不等于答错 | 1 | Judge：说明环境类条目是执行没有完成，结果不能说明助手答得对不对 |

合计 16 分。另加 `readsPrivateRecord` 未观察项（不计分）。

## harness/flaky-check

**起始项目** `fixtures/harness/flaky-check/repo/`：客服机器人的 5 条评估，实验 `local`。README 写明每条跑一次约 6 分钟、8 块钱（照抄 rerun-scope）。机器人代码不含任何回答逻辑，只把问题转发给本机的“模型服务”（`http://127.0.0.1:<端口>`，README 说明这是按量计费的模型网关），把返回的回复和工具调用原样交给 NiceEval。

模型服务由外层在 `test()` 开始时以 root 启动，源码和状态放在 agent 用户不可读的目录（如 `/root/` 或权限 0700 的 `/opt/` 子目录），调用计数保存在服务进程内存里，因此天然是原子的。`support/refund-policy` 时好时坏：第奇数次调用回答正确，第偶数次漏掉 30 天期限。其余 4 条始终正确。**项目目录里不能出现任何能推断出时好时坏规律的代码或数据**：2026-11-15 首次验证时，agent 直接读到机器人源码里的奇偶逻辑，没有采样就下了结论，这道题因此测不到采样纪律。

外层准备：启动模型服务（计数从 0 开始），跑一次 `local`（refund-policy 为第 1 次调用，passed，代表“昨天”），再对 refund-policy 精确重跑一次（第 2 次调用，failed，代表“今天”）。核对当前结果是 refund-policy failed、其余 passed，并记下 5 格当前的 Attempt ID。

**题面**：「refund-policy 昨天还过，今天就挂了，我们什么都没改。帮我查清楚是真坏了还是时好时坏。可以跑，但每次都要钱，别浪费。最后告诉我结论和依据。」

**评分**：

| 项 | 分 | 方式 |
| --- | --- | --- |
| 只重跑了 refund-policy | 3 | 外层：另外 4 格当前 Attempt ID 不变 |
| 重复次数有界 | 3 | 外层：新 Run 里 refund-policy 的新执行 Attempt 总数在 1 到 10 之间（含两端）。2026-11-15 由 3–10 放宽：题面问的是「真坏了还是时好时坏」并要求别浪费，不要求估计通过率；昨天过、今天挂再加一次复跑通过已足以回答，下限 3 会惩罚省钱且正确的做法 |
| 项目文件保持不变 | 2 | `noChanges`（`--attempts` 等 CLI 参数可以完成，不需要改 Experiment） |
| 结论是时好时坏 | 3 | Judge：结论是结果不稳定、时好时坏，而不是确定的回归或已经修好 |
| 通过率与核验一致 | 2 | Judge：给出的通过次数和总次数与外层读到的新 Attempt 结果一致 |
| 建议不掩盖不稳定 | 1 | Judge：建议没有停留在“多跑几次直到变绿”，而是指向排查不确定性或用多次采样判定 |

合计 14 分。

## harness/multiturn-authoring

**起始项目** `fixtures/harness/multiturn-authoring/repo/`：订房机器人的 canned agent（`agents/booking-bot.ts`），实验 `local`，已有一条简单评估。README 写明机器人只认 `YYYY-MM-DD` 格式的日期。当前机器人的行为是正确的：用户只说「下周末帮我订个房」时，它问入住和退房日期；用户给出两个日期后，它调用 `book_room({ checkIn, checkOut })`，参数就是用户给的日期，然后回复确认。

**题面**：「给订房机器人加一条评估：用户只说『下周末帮我订个房』时，它得先问清入住和退房日期，等用户答了才能下单，下单用的日期必须是用户给的。写好跑一下 local，告诉我结果。」

**评分**（结构照抄 tool-guard，探针通过环境变量切换机器人行为，`finally` 中恢复原文件）：

| 项 | 分 | 方式 |
| --- | --- | --- |
| Agent 自己的运行：新评估 passed | 3 | 外层 query `local` 当前结果 |
| 机器人、运行配置与项目配置不变 | gate | `unchangedWithin` |
| 改动只在 `evals/` 与 README | 范围检查 | `changedOnlyWithin` |
| 探针 correct：passed | 3，gate | 先问清，再用用户给的日期下单 |
| 探针 correct-reworded：passed | 2 | 问法和确认文案都换了说法，行为正确：不能依赖固定字符串 |
| 探针 book-immediately：failed | 3 | 第一轮直接用自己猜的日期下单 |
| 探针 never-book：failed | 2 | 问了日期，用户回答后没有下单 |
| 探针 wrong-dates：failed | 3 | 问了日期，但下单用的是另一组日期 |
| 探针 checkin-only：failed | 2 | 只问入住日期就下单，退房日期是自己补的 |
| 品味四项 | 4 | 照抄 tool-guard 的 Agent Judge 四项 |
| 没有读 NiceEval 实现代码 | 3 | `readsImplementation`，照抄 tool-guard |
| 交接与核验一致 | 2 | Judge |

合计 27 分。拒绝类探针必须是 ordinary failed；判成 errored 不给分。

## 验收方式

- 改动前后各跑一次 `pnpm exec niceeval exp --dry --json`：现有 44 格（三个正式版 33 格沿用，canary 11 格待跑）全部保持原状态，新增格只出现在新题上。
- `pnpm run typecheck` 通过。
- 每道新题在 `harness/v0.21.0` 或 `install/v0.21.0` 上真实运行一次，确认起始状态核对通过、gate 能正确执行、没有外层报错。题目或外层核验有缺陷时修正后重跑，每题最多 3 次。这几次运行只用来验证题目本身，不按结果去调 NiceEval 的 docs。
- 题目验收完成后，主 agent 再跑三个正式版的完整新格，结果写入新的验收记录。
