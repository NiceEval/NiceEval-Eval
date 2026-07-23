# NiceEval-Eval：niceeval 的文档效果评估仓库

用 niceeval 评估**正在使用 niceeval 的 coding agent**，量化 `INIT.md` 与随包 `INDEX.md`
这套文档链的真实效果，为文档文案的每次改版提供回归面。

被测对象是 coding agent CLI（当前是 codex），跑在 Docker 隔离 workspace 里。
**coding agent 与模型是测量仪器，不是被改进对象**——`debug/` 还留着一组对照组
（`with-agent-rules` vs `no-agent-rules`）把模型能力从归因里剥离出去；`install/` 不靠
对照组度量，各组只差被评的 niceeval 版本，见下面「install 评估的任务指令」。

两组评估共用这个仓库，sandbox、候选版本与运行机制共享，fixture 与题面独立：

| 评估 | 问题 | 设计文档 |
|---|---|---|
| `install/` | 从零接入：agent 能不能把 niceeval 装进一个真实项目并写出合格的三件套 | `agent-install-eval.md` |
| `debug/` | 接入之后：agent 能不能从已有结果数据里查出一条指定信息 | `agent-debug-eval.md` |

## 快速开始

```sh
pnpm install
export CODEX_API_KEY=sk-...      # 被测 agent
export OPENAI_API_KEY=sk-...     # 裁判模型（产出质量层）

pnpm exec niceeval exp install   # 跑安装评估
pnpm exec niceeval show          # 看结果
```

只跑一条 eval：

```sh
pnpm exec niceeval exp install install/vanna              # 只跑一条 eval
```

## 三层评分

三层从精确断言到 judge 逐层放宽，**只有「检查 niceeval 是否安装好」这层 gate**。这是刻意的：
三层混成一个分数就失去了归因能力，而归因正是这套评估唯一的产出。

| 层 | 判什么 | 严重度 | 失败意味着 |
|---|---|---|---|
| **检查 niceeval 是否安装好** | 安装链的客观事实：依赖解析到候选版本、config 存在、托管区块存在、typecheck 干净、niceeval 能发现 agent 写的 eval | `gate` | 链路走不通 → 修 `INIT.md` 对应步骤或 `init` 的行为 |
| **产出质量层** | agent 写出的 experiment 与 eval 是否真的关联到这个被测系统——不是各写各的、互不搭界 | `soft` / judge | 契约没被读懂 → 定位到那一页 docs-site 改写 |
| **路由层** | agent 是否以随包 `INDEX.md` 为入口、读到与任务匹配的页面、有没有退回官网 | `soft`（纯计量） | 路由不对 → `INDEX.template.md` 导语或页面 `description` |

路由层不 gate，因为它回答的是「文档起作用了吗」，不是「这次接入算不算成功」。
让它拖垮 verdict 会把文档问题和机制问题混成一个数字。

失败按「路径 × 答案」的组合归因——路径对了答案还错，和路径就没走对，指向的是完全不同的修复面。

## install 评估的任务指令

`install/` 的每组配置只差被评的版本（`v0.9.1`、`v0.4` = 0.4.1）：每条 eval 的 `send()` 都
明确指向那个版本按 tag 存档的 `INIT.md`（`READ ${candidateInitDocUrl(version)} ...`，
GitHub raw 地址，不缓存进沙箱），agent 按它走「读引导 → 探测项目 → 装候选版本 → init →
交接给随包 INDEX.md」这条完整链路。

随包文档（`node_modules/niceeval/INDEX.md` 与 `docs-site/zh/**`）是包的一部分，agent 一
装上包它就必然存在。随包文档起没起作用由**路由层单独计量**（有没有以 `INDEX.md` 为入口、
有没有读到与宿主形态匹配的页面），不靠对照组。

`debug/` 的对照组（`with-agent-rules` vs `no-agent-rules`）是另一回事，衡量的是「查已有
结果」这条链路上**那段指针**的增量。自变量是 `niceeval init` 往 `AGENTS.md` 写的托管
区块在不在：区块告诉 agent「niceeval 不在你的训练数据里，先读
`node_modules/niceeval/INDEX.md`」，随包文档由此被接上。

随包文档本身摘不掉（它是包的一部分），能摘的只有通往它的指针，所以自变量取在指针上——
这是**结构性隔离**，两组题面逐字相同，差值里不掺 agent 的服从度。对照组要是自己摸到了
`INDEX.md`，那本身就是结论：说明这套文档不靠指针也能被发现，不是需要剔掉的污染。

托管区块的文案是候选自己 `src/cli.ts` 里的常量、各版本不同，所以由候选的 `init` 现写，
harness 不抄——抄了就永远停在抄的那个版本。

## 候选版本

被评的是**某个具体版本的 niceeval 发布**，不是 npm 上的 latest。每个 experiment 用
`CANDIDATE_VERSION` 明确钉一个版本号，这一个值贯穿三处：sandbox 投放哪个版本的
`INIT.md`、eval 让 agent 装哪个版本、「检查 niceeval 是否安装好」这层核对哪个版本。

没有手工 pin 步骤：experiment 加载时 `await ensureCandidate(<版本号或 dist-tag>)`
（`lib/candidate.ts`），本地没有这个版本的 `.candidate/<version>/manifest.json` 就现场物化
一份。canary 组传的是 dist-tag，上游随时发新 canary，这边下一次跑自动跟上。

物化下来的只有 `manifest.json`（版本号 + 随包文档清单）：

- **不存 tarball。** 候选一律是已发布版本，`pnpm add niceeval@<version>` 就能精确复现；
  npm 的同一个版本号不可重发，版本号本身就是完整的身份。
- **`INIT.md` 不缓存本地，按版本取自 GitHub tag**：它不在包的 `files` 白名单里，装了包也
  拿不到；niceeval.com/INIT.md 只有「现在」这一份，没有历史版本。真正按版本存档的是
  [`CorrectRoadH/niceeval`](https://github.com/CorrectRoadH/niceeval) 仓库的 tag，eval 让
  agent 直接读 `https://raw.githubusercontent.com/CorrectRoadH/niceeval/v<version>/INIT.md`。
  物化时会探一次这个 URL 是不是 200——链接失效在实验加载这一步就响。评「某个版本的文案
  改版有没有效果」时，读到的就是那个版本发布时的 `INIT.md`，不会被网站今天的最新修订
  悄悄替换掉。
- **版本号要真的传达给 agent。** 题面明写「这台机器最终必须装上 niceeval@<version>」——
  这是环境约束，不是提示怎么装；怎么装正是考点。不交代的话 agent 只会装 latest，
  「依赖解析到候选版本」那条 gate 在版本对比组上必然红。
- `manifest.json` 里记着这个版本随包发了哪些文档页，跑之前用来校验题库的合格落点还在不在
  （见下面「两种零」）。
- 环境钩子写下的文件进 git 基线，**不会被算进 agent 的 diff**，所以 diff 断言不会被污染。

### 对比不同 niceeval 版本

一个版本一个 experiment，只差版本这一个变量：

```sh
pnpm exec niceeval exp install/v0.9.1     # niceeval@0.9.1
pnpm exec niceeval exp install/v0.4       # niceeval@0.4.1
```

跟 `compare-models` 一样，这组对照只应该有一个变量：写新的版本对比组时把 `model`、
eval 集合都钉死，只让 `CANDIDATE_VERSION` 变化。

0.4.1 还没有随包文档这套机制（0 页、无 `INDEX.md`、`init` 也不写 `AGENTS.md` 托管区块），
所以路由层在那一组读零是**正确结果**，正是这组要测出来的东西。

### 两种零

路由层读出的 0 有两种，在分数上长得一模一样：

| | 含义 | 该怎么办 |
|---|---|---|
| **真 0** | 这个版本压根没有随包文档（0.4.1） | 什么都不用做，这就是结论 |
| **假 0** | 有文档，但题库写的落点被改名/搬走了 | 更新题库，否则会被误读成「文档没起作用」 |

路由层是软分、按设计不 gate，所以假 0 不会让任何东西变红。跑之前拿题库的每个落点去
`manifest.json` 的文档清单里核一遍，对不上就直接失败——把静默的假 0 变成响的。
候选本来就没有随包文档时不报错：那是真 0。

## fixture

### install fixture：真实开源项目矩阵

宿主不再是仓库里签入的静态代码，而是三个锁定了具体 tag 的真实开源 agent 项目——每条
`evals/install/*.eval.ts` 用 `lib/fixture.ts` 的 `cloneFixture` 在每次 attempt 里把对应
`repoUrl@ref` clone 进沙箱工作区，作为 agent 之后改动的起点。三条 eval 各写各的
`send()` 文案、核心用例 rubric 与合格文档落点——`cloneFixture`、`collectMechanismFacts`、
路由层判定这些机械的、跟具体宿主无关的部分留在 `lib/` 里当工具函数复用，但每条接入
路径要考什么、断言怎么写，都是各文件自己的判断，不经过一个通用骨架来间接决定：

| fixture | 项目 | 锁定 tag | 覆盖的接入路径 |
|---|---|---|---|
| `vanna` | [vanna-ai/vanna](https://github.com/vanna-ai/vanna) | `v2.0.2` | 非 TS 宿主 + 自研 JSON（非流式）→ 就地建 `package.json` + 手写 `send` |
| `db-gpt` | [eosphoros-ai/DB-GPT](https://github.com/eosphoros-ai/DB-GPT) | `v0.8.1` | 非 TS 宿主 + OpenAI Chat Completions 兼容形状（仍无内置件）→ 手写 `send` |
| `gpt-researcher` | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | `v3.6.0` | 非 TS 宿主 + 自研 WebSocket 帧协议 → 手写 `send` 与事件映射 |

`ref` 锁定的是某次具体的大版本发布，不是分支：同一个 tag 重新 clone 得到完全相同的文件，
跑分不会随上游新提交漂移。`DB-GPT` 仓库体积很大，`excludeDirs` 用 sparse-checkout 剪掉了
与「装 niceeval」无关的 `docs/` 与 `assets/`；其余两个直接整仓库 clone。

之前还接入过 `finrobot`（[AI4Finance-Foundation/FinRobot](https://github.com/AI4Finance-Foundation/FinRobot)
`v1.0.0`），已移除：它拉财务数据打的是 FMP 已下线的 `/api/v3/`/`/api/v4/` legacy 端点
（FMP 2025-08-31 后只认 `/stable/*`），拿真实 key 也全 403；上游 issue 开了近一年没修，
唯一的修复 PR 也晾了一个多月没人理，判定为这个模块事实上停止维护，不是环境配置能解决的。

⚠️ **这三个 fixture 换来「贴真实项目」，也放弃了两个旧设计里的性质。** 一是旧的
`ai-sdk-app` 覆盖的「AI SDK `useChat` → 内置 `uiMessageStreamAgent` 零映射」这条分支
目前没有对应项目，暂时失去覆盖；二是旧宿主**确定性、零 LLM 调用、零 API key**，三个
真实项目都要连真实模型才能真正跑起来，「检查 niceeval 是否
安装好」这层里 `producedResults` 那条软分（见上面「三层评分」）在没有配那些 key 的环境里大概率读零——
这是软分不是 gate，不影响 verdict，但看板上会显得「没跑通」。产出质量层的 judge 断言评的是
agent **写出的 experiment/eval 代码**是否真的关联到被测系统、贴着真实用例、走真实传输，
不依赖宿主真的启动成功。



### debug fixture：签入的真实结果数据

`fixtures/results/` 下是整目录签入的 `.niceeval` 结果数据加一份人工核对的题库。
数据来自 `coding-agent-memory-evals`（niceeval 0.4.6 产出，10 个 experiment / 84 attempt），
8 条题的标准答案全部从数据核对完毕。重新导出的步骤与验收标准见
[`fixtures/results/README.md`](fixtures/results/README.md)。

## 边界

- **评文档链，不评 agent 编码能力。**
- **不评 niceeval 的功能正确性。** `show` 输出自身的 bug 由 niceeval 仓库的单元测试与 E2E 守护；
  这里测的是「这套输出加文档能否支撑 agent 完成任务」。本仓库变红不阻塞发版。
- **debug fixture 只读。** 数据永不重跑，答案在出题时核对一次，之后不腐烂——
  这让它能当作 CLI 输出改版的回归面。
- **不追求覆盖全部文档页面。** fixture 按判断分支组织，页面级的文案质量由产出质量层的
  失败归因倒查，不为每页文档造一个场景。

## 一个已知的取舍

`INIT.md` 里有一条架构硬规则：adapter 不能代管被测进程，应用应该由用户自己启动。
但沙箱里没有「另一个人」来启动被测应用。任务指令因此明确写着：需要时自己在 shell 里
把应用起到后台，**但不要把启动进程写进 adapter 代码**——被考的那条规则由此保持完整。

相应地，「真的跑出过一次结果」只作软分不作 gate：它依赖 agent 是否顺手起了后台进程，
波动大，gate 会把「装对了但没跑」误判成安装失败。
