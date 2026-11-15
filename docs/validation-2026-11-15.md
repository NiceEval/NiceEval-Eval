# 2026-11-15 三个正式版本的对比验收

本轮比较 `0.19.0`、`0.20.0` 和 `0.21.0` 三个正式版本，共 33 格，全部按 HEAD `ce7bcfe` 的判据完成：**31 passed、2 failed、0 errored**。Harness 三个版本都是 9/9 passed；DB-GPT 三个版本都通过；GPT Researcher 只有 0.21.0 通过。

这一轮没有跑 canary。`0.21.1-canary.124` 比 `0.21.0` 多出 34 个提交，全部是类型重构（`exactOptionalPropertyTypes`）和 CI/E2E 修正；INIT、随包 INDEX 和产品文档都没有改动。这个仓库衡量的是文档效果，因此跑它测到的仍是 0.21.0 那套文档，只会多花钱、多引入噪声。下次有文档或 CLI 输出变化的版本发布后，再重新加入 canary。

## 相对 2026-11-14 的判据变化

两处 Install 判据修正（都在 0.21.0 入组之后）让安装题必须在这三个版本上重新跑：

- `752ddbf`：DB-GPT 的真实响应门槛原先要求查询结果出现在 assistant 消息里。如果 Adapter 忠实地把 DB-GPT 的 chart-view 映射成 tool result 和结构化数据，这道门槛会失败，而映射判据却给同一设计加分。现在结果出现在 tool event 或 data 中也算。
- `ce7bcfe`：INIT 要求 agent 记录接入计划，agent 会把计划写进 README 或说明文件；但首轮 Turn 只显示 file_change 回执，导致 8 个安装 Attempt 的“提出核心用例”都被判为未满足。现在首轮 Judge 能同时看到首轮对话和它写下的说明文件正文。

Harness 判据自 `4017056` 以后没有变化。0.19.0 和 0.20.0 的 Harness 结果沿用 2026-11-14 那批及其 9 格重跑（见 [validation-2026-11-14](validation-2026-11-14.md)）；0.21.0 的 Harness 是新执行的。

## Harness

| 版本 | 分数 | Run |
| --- | --- | --- |
| harness/v0.19.0 | 147/156 | `5ccdc5cf`（沿用）+ `cb06c1d2`（重跑 2 格） |
| harness/v0.20.0 | 151/156 | `b4eac777`（沿用）+ `dbeb0750`（重跑 2 格） |
| harness/v0.21.0 | 154/156 | `da4b1c5e-81c5-4173-8668-a98da03f1371` |

0.21.0 逐格结果（Invocation `s_d7c24532-2853-46c7-bbf6-94c8c6fdb040`）：

| 条件 | 分数 | Attempt |
| --- | --- | --- |
| regression-triage | 17/17 | `@1XSGPF8BQ3NJN` |
| rerun-scope | 17/17 | `@1QB653JJ0K3R1` |
| terminal-bench/cancel-async-authoring | 22/22 | `@1RA6J8D6CXTZD` |
| terminal-bench/classifier-pressure | 15/15 | `@12XAX587RZ95M` |
| terminal-bench/log-summary | 14/14 | `@10JHQAR87NQXJ` |
| terminal-bench/log-summary-repair | 23/23 | `@196NWPKREFFY2` |
| terminal-bench/regex-log | 8/10 | `@1G6GKGG2KZD4D` |
| terminal-bench/regex-log-authorized | 10/10 | `@1T9MKCP02R34R` |
| tool-guard | 28/28 | `@14Z7KYX6YX5GK` |

三个版本之间的分数差异集中在四个条件上：

| 条件 | v0.19.0 | v0.20.0 | v0.21.0 |
| --- | --- | --- | --- |
| log-summary | 12/14 | 14/14 | 14/14 |
| regex-log | 8/10 | 8/10 | 8/10 |
| regex-log-authorized | 8/10 | 10/10 | 10/10 |
| tool-guard | 25/28 | 25/28 | 28/28 |

regex-log 三个版本都在“区分依赖缺失与业务失败”上得 0/2。按判分理由，agent 补齐了 Python 环境，也报告了 classifier-debug 的判定失败，但没有说明缺 Python 依赖的是 regex-log 的 verifier，也没有说明这类环境问题和业务失败属于不同层。三个版本都一样，所以它不影响版本比较；它属于文档或结果呈现能否帮 agent 区分 errored 与 failed 的问题，有待单独查。

0.19.0 和 0.20.0 的 tool-guard 在 2026-11-14 的重跑中确认确实读了 `node_modules/niceeval/dist/assertions/match.js`；0.21.0 没有读实现，得 28/28。

## Install

| 候选 | DB-GPT | GPT Researcher | Run |
| --- | --- | --- | --- |
| v0.19.0 | passed，91/98，`@11FBAN59PAVMD` | failed，49/69，`@10C2A69ZVNN3B` | `558c6db5-25d2-4cba-b3cd-35b679557ad2` |
| v0.20.0 | passed，90/98，`@1NF62V0N8JBHT` | failed，52/69，`@1SAKJ3BJ6Y6VV` | `6b57b89d-f3ac-4c8b-9723-9a3326f39643` |
| v0.21.0 | passed，98/98，`@15V56D7X5X35J` | passed，84/98，`@1W6XX6APH4T1M` | `223bdedf-adec-40fb-a189-f1df7f14b165` |

Invocation `s_09bd46f8-0789-491d-bf0a-3e85b6d63597`，2026-11-15 03:55–04:27 UTC，6 格均实际执行。

两个旧版本的 GPT Researcher 失败方式和 11-14 那批相同：都在 `niceeval/` 子目录另建 Node 项目，三道 gate 失败（根工具项目声明精确候选开发依赖、不另建子目录 Node 项目与锁文件、根目录 `pnpm exec` 找到本地 NiceEval），在根目录 CLI 那一步就停了。**69 是提前停止前已登记的分值范围，不是全题满分，不能和 98 直接比较。** 稳定可比的结论只有一条：两个旧版本都没能在已有 pnpm workspace 的根目录接入，0.21.0 做到了。

0.21.0 GPT Researcher 的 23 道 gate 全部通过，丢的 14 分是：

- 核对能力边界 0/2：说明了带引用的研究报告，但没说明自主、多源检索与结构化报告。三个版本都在这一项丢分。
- 提出核心用例 0/2。
- 断言检查报告内容、结构与引用 0/6。
- 交接引用 locator 并如实报告 0/3。
- agent 自写 Eval passed（弱证据）0/1。

DB-GPT 三个版本都过了全部 gate。0.21.0 拿满分；0.19.0 丢 7 分，0.20.0 丢 8 分。

## 用量

公开 `show exp:<id> --json` 报告的 token 合计：Harness 548,657 / 549,193 / 575,253，Install 348,455 / 258,589 / 345,820（依次为 0.19.0 / 0.20.0 / 0.21.0）。0.19.0 和 0.20.0 的 Harness 有 7 格沿用旧结果，费用为 unavailable；其余费用是按模型单价估算的值，不是计费账单。这些数字只能说明大致规模，不能用来给成本排名。

## 结果的来源与可复查性

6 格安装题是在一个导出到 `/tmp/eval-run-snapshot` 的工作区快照里运行的。快照内容等于 HEAD `ce7bcfe`（`.snapshot-commit` 记录了提交号，`evals/`、`lib/`、`experiments/` 逐文件比对一致），node_modules 链接到本仓库。运行后用公开的 `niceeval run export` 把这 3 个 Run 导出，再用 `niceeval run import` 导入本仓库的 Record（导入 3 个，已有 0 个）。导入后，在本仓库执行 `niceeval exp --dry` 显示三个正式版的 33 格全部沿用，canary 11 格待跑。导出文件保存在 `~/Code/codex-prompts/NiceEval-Eval/records/install-six-20261115.sqlite`。

所有分数都来自本项目所装版本的公开 CLI，没有读私有 Record 文件：

```sh
pnpm --silent exec niceeval show exp:harness/v0.21.0 --json
pnpm --silent exec niceeval show exp:install/v0.21.0 --json
pnpm --silent exec niceeval show @1W6XX6APH4T1M assertions
```

## 已知问题

- 03:41 有一次被中断的 Invocation（`s_2b7760e2-5b06-4e9c-9981-0785f23b7eeb`，三个 Run 各完成 1/2），之后 `exp --dry` 一直把三个正式版的 DB-GPT 标成 `running in another invocation`（JSON 里是 `locked: true`），但 `invocation list` 显示没有活跃会话，`run recover --orphaned` 也报告没有孤儿 Run。沿用结果不受影响，但中断后留下的锁没有被释放。这是 NiceEval interrupt 收口的缺陷，由 NiceEval 仓库处理。
- 每个版本、每道题只有一次外层 Attempt。这是已有开发题上的产品工作流比较，不能单独归因于文档，也推不出统计显著性。
