# 2026-11-14 Instabox 产品与文档效果验收

本轮 33 格已全部结束：**30 passed、3 failed、0 errored、0 skipped**。2026-11-15 修正三处判据误伤后重跑受影响 9 格，修正后为 31 passed、2 failed，见文末「判据修正与重跑」。Harness 三版均 9/9 passed；DB-GPT 三版通过；GPT Researcher 三版失败，失败位置不同。命令退出码为 1，Invocation 的 completion 为 completed，未开始项为 0。

## 批次与可比范围

Invocation：`s_ab1aa458-0601-4e54-826d-2f43be71fa88`。2026-11-14 15:35:22 UTC 开始，16:47:00 UTC 完成发布，16:47:03 UTC 汇总结束，总耗时 4,300,468 ms（约 71 分 40 秒）。33 格均实际执行，没有沿用旧结果，总并发 10。

被测候选是 `0.19.0`、`0.20.0`、`0.20.1-canary.123`。宿主使用正式 `dev:link` 安装的本地候选，SHA-256 为 `9124d5da354ae20e140b7e8dd46a61a429db9dffb930d231bd937a1a4c476153`。运行期间冻结共享 dist；同时进行的源码 CI 修复没有进入此次宿主运行时。本次结果不能替代这些后续修复的 tarball 验收。

每个版本、每道题只有一次外层 Attempt。这是已有开发题上的产品工作流比较，不能单独归因到文档，也不能推断统计显著性。本轮没有新增盲测保留题，没有为提高分数重跑失败项。

## Harness


三版各 9/9 passed。通过率相同，分数仍有差异；本轮没有新增盲测保留题。

| 版本 | 分数 | Run |
| --- | --- | --- |
| harness/v0.19.0 | 146/156 | `5ccdc5cf-8193-41da-954d-98e22182accb` |
| harness/v0.20.0 | 150/156 | `b4eac777-16a6-4e6b-825e-bb4a9e3f1bac` |
| harness/canary | 152/156 | `d57cacbd-cdf2-4e8e-b025-f270985fef4d` |

| 版本 | 条件 | Verdict | 分数 | Attempt |
| --- | --- | --- | --- | --- |
| harness/v0.19.0 | regression-triage | passed | 17/17 | `@1BCT92BZEJBWN` |
| harness/v0.19.0 | rerun-scope | passed | 17/17 | `@1ZABNYW3MCADS` |
| harness/v0.19.0 | terminal-bench/cancel-async-authoring | passed | 21/22 | `@17AVFR70WG83Q` |
| harness/v0.19.0 | terminal-bench/classifier-pressure | passed | 15/15 | `@10QF09GMXVZSD` |
| harness/v0.19.0 | terminal-bench/log-summary | passed | 12/14 | `@1NKG01FKK582J` |
| harness/v0.19.0 | terminal-bench/log-summary-repair | passed | 23/23 | `@1FEVKB7SMY91V` |
| harness/v0.19.0 | terminal-bench/regex-log | passed | 8/10 | `@1PZAFYDM05TQD` |
| harness/v0.19.0 | terminal-bench/regex-log-authorized | passed | 8/10 | `@18553AGZT2RTR` |
| harness/v0.19.0 | tool-guard | passed | 25/28 | `@187GN5WGAY4G1` |
| harness/v0.20.0 | regression-triage | passed | 17/17 | `@10PN1GJ1JXGCN` |
| harness/v0.20.0 | rerun-scope | passed | 17/17 | `@1QMP9YWXB2RKM` |
| harness/v0.20.0 | terminal-bench/cancel-async-authoring | passed | 21/22 | `@1W1VNN279X531` |
| harness/v0.20.0 | terminal-bench/classifier-pressure | passed | 15/15 | `@1YQ7RFQY57MA6` |
| harness/v0.20.0 | terminal-bench/log-summary | passed | 14/14 | `@1W5NYJ4MH427G` |
| harness/v0.20.0 | terminal-bench/log-summary-repair | passed | 23/23 | `@14PB58J10WFYD` |
| harness/v0.20.0 | terminal-bench/regex-log | passed | 8/10 | `@1X7890BTEF335` |
| harness/v0.20.0 | terminal-bench/regex-log-authorized | passed | 10/10 | `@1DBDJ58PS7P5G` |
| harness/v0.20.0 | tool-guard | passed | 25/28 | `@158EZE5FWXK46` |
| harness/canary | regression-triage | passed | 17/17 | `@1N71M9MV0FWN4` |
| harness/canary | rerun-scope | passed | 17/17 | `@13ZHQYGNWWCFK` |
| harness/canary | terminal-bench/cancel-async-authoring | passed | 21/22 | `@1HV02F179HRCW` |
| harness/canary | terminal-bench/classifier-pressure | passed | 15/15 | `@1TK78K8YHEXXK` |
| harness/canary | terminal-bench/log-summary | passed | 14/14 | `@1TQN4REMFGQZ6` |
| harness/canary | terminal-bench/log-summary-repair | passed | 23/23 | `@1ABPRM9EB7C9J` |
| harness/canary | terminal-bench/regex-log | passed | 10/10 | `@10G7Y1E55CQD9` |
| harness/canary | terminal-bench/regex-log-authorized | passed | 10/10 | `@1GPF70JAKNCVB` |
| harness/canary | tool-guard | passed | 25/28 | `@1FPECNCYGQTYX` |

Canary 的 tool-guard 为 25/28，“没有读 NiceEval 实现代码”得 0/3；cancel-async-authoring 为 21/22，“判据平铺在打分处”得 0/1。两项都是判据问题，修正与重跑见下文。

## Install

| 候选 | DB-GPT | GPT Researcher | Run |
| --- | --- | --- | --- |
| v0.19.0 | passed，88/98，`@1KFH1HDZ2G5S9` | failed，44/69，`@14FPYHQ26727J` | `ea5520ed-2516-4231-aa52-4c54cbe3654e` |
| v0.20.0 | passed，80/98，`@1P7FPDZSN5THW` | failed，50/69，`@1R3AQYT43ANMR` | `571200e9-f5d9-45c7-9a61-72667239973d` |
| canary | passed，92/98，`@16SSGFHDXEGJX` | failed，76/98，`@1BSF9GN6M9E4T` | `c15203b2-1cfe-4b01-a3c7-6f9dc46ad3a2` |

三个 DB-GPT Attempt 的 44 条断言均已公开读回，gate 全部满足，包括实际运行、当前 Attempts 已发布和真实 DB-GPT 响应。Canary 的 6 分损失均来自首轮需求确认。评分 complete 不等于所有取证栏目完整，部分材料仍标 partial。

两版稳定版 GPT Researcher 都在 `niceeval/` 子目录另建 Node 项目。公开 diff 与断言确认三个 gate failed：根工具项目声明精确候选开发依赖、禁止子目录 Node 项目与锁文件、根目录本地 CLI。两者均在“根目录 pnpm exec 找到本地 NiceEval”停止；38 条断言没有用 unavailable 代替这项失败。**69 是提前停止前已登记的分值范围，不是全题满分；不能与完成评分路径的 98 分分母直接比较，也不能把这两格称为接入完成。**

Canary GPT Researcher 走完评分路径，共 53 条断言；唯一失败 gate 是“保留已有 workspace 边界与原有检查源码”。它通过了根目录精确候选依赖、既有 pnpm/CommonJS/脚本/工具依赖、禁止子目录项目、冻结安装、原有检查、discovery、dry plan、真实运行和真实响应的 gate。

公开文件变化 `fc_efc23b7895b64648ac7e0104c02a3f85` 显示 `pnpm-workspace.yaml` 新增 `minimumReleaseAgeExclude: [niceeval@0.20.1-canary.123]`。
执行轨迹表明这一项不是 agent 写的：agent 只运行了 `pnpm add -Dw --save-exact niceeval@0.20.1-canary.123`，候选发布不足 24 小时，pnpm 12 自动写入豁免并输出 `Added 1 entry to minimumReleaseAgeExclude`。
因此这格 failed 是判据误伤，已在 2026-11-15 修正后重跑，见下文「判据修正与重跑」。

Canary 的 22 分损失包括首轮定题 6 分、研究配置透传 3 分、报告内容/结构/引用检查 6 分、真实引用风险负例 4 分、Match/未知状态/前提即停写法各 1 分。真实响应门槛通过不意味着这些质量项已经完成。

## 准备、取证与清理

25 个 Before cache 节点全部 prepared，hit 0、degraded 0、failed 0。输出记录 36 条 warning：20 条 `telemetry-collect-failed`、10 条 `telemetry-budget-exceeded`、6 条 `sandbox-transport-reconnected`。这是事件数，不是互斥 Attempt 数。

运行期间使用 `invocation show` 定位实例，再通过 `instabox exec` 只读查看进程和 `git status`；实际观察到 Codex 执行、Python/uv 安装和工作区改动。现场观察不代替最终公开断言。结束后通过 `instabox ls --json` 核对，本轮实例已全部回收；本轮运行终端已回收，无 pane、tab 或 worktree 残留。

清理和 telemetry 诊断保留原 Verdict。例如 `@1N71M9MV0FWN4` 为 passed、17/17，同时公开 `telemetry-collect-failed` 与 `teardown-failed`；最后的 canary GPT Researcher 也有相同类别诊断。trace、conversation、commands、usage 等栏目部分为 partial。最终实例列表无残留，不能反推每次 teardown 均无错误。

公开汇总报告 inputTokens 2,583,869、outputTokens 210,159；因采集有缺失，这不是完整计费总量。Provider 未提供完整费用，费用保持 unavailable，不用 0 或自行套模型单价补齐，也不据此排名成本。

## 公开复查

所有结果均通过本项目安装版本的公开 CLI 获取，没有读取私有 Record 文件。使用与运行相同的 `NICEEVAL_HOME`：

```sh
export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current-20261114"
pnpm --silent exec niceeval invocation show s_ab1aa458-0601-4e54-826d-2f43be71fa88 --json
pnpm --silent exec niceeval show run:c15203b2-1cfe-4b01-a3c7-6f9dc46ad3a2 --json
pnpm --silent exec niceeval show @1BSF9GN6M9E4T assertions --json
pnpm --silent exec niceeval show @1BSF9GN6M9E4T fc_efc23b7895b64648ac7e0104c02a3f85 --json
```

Attempt 首页 `show @<locator> --json` 返回多行 JSON（attempt.get 与 attempt.usage），须逐行解析。后续对象沿响应里的 `links[].command` 读取。

原始运行输出保存在本机 `/tmp/niceeval-paid-33-20261114.ndjson`；最终公开读取与资源核对收据为 `/tmp/niceeval-paid-final-*`。这些临时文件不是版本库中持久保存的证据，复查应使用上表 Run、Attempt 与 Invocation 地址。

## 判据修正与重跑（2026-11-15）

复查本轮结果发现三处判据误伤，修正于提交 `4017056` 后只重跑受影响的 9 格（`--dry` 确认其余 24 格沿用）：

- GPT Researcher 的「保留已有 workspace 边界」要求 `pnpm-workspace.yaml` 一字不变，而 pnpm 会为发布不足 24 小时的候选自动写入 `minimumReleaseAgeExclude`。现在 `packages` 必须不变，只放过该候选这一条豁免。
- tool-guard 把 `rg … node_modules/niceeval/dist -g '*.d.ts'` 这类只搜类型声明的命令算作读实现（v0.19.0 与 canary 均因此 0/3）。现在只认 `src/` 或 `dist/` 下明确的 `.js/.mjs/.cjs` 路径。
- cancel-async 的「判据平铺在打分处」要求在 Eval 正文复述官方隐藏测试的每一项，与题目要求相矛盾，三版恒为 0/1。现在只要求正文写明运行哪份官方测试、按什么门槛判通过。

Invocation `s_986ce6dd-dfbd-48da-83d9-8433dc8a458d`，2026-11-15 01:07–01:31 UTC。

| 版本 | 条件 | Verdict | 分数 | Attempt |
| --- | --- | --- | --- | --- |
| harness/v0.19.0 | cancel-async-authoring | passed | 22/22 | `@1EW22AASVX96T` |
| harness/v0.20.0 | cancel-async-authoring | passed | 22/22 | `@14M85KP785PTY` |
| harness/canary | cancel-async-authoring | passed | 22/22 | `@1FNYTTXZAZ872` |
| harness/v0.19.0 | tool-guard | passed | 25/28 | `@1GGKQWPSF0T9E` |
| harness/v0.20.0 | tool-guard | passed | 25/28 | `@1T2YN7R7CQGQA` |
| harness/canary | tool-guard | passed | 27/28 | `@1XT1NKM370PJ4` |
| install/v0.19.0 | gpt-researcher | failed | 47/69 | `@1XJX74D69G6DD` |
| install/v0.20.0 | gpt-researcher | failed | 44/69 | `@1QC4VEZSWW1PA` |
| install/canary | gpt-researcher | passed | 77/98 | `@1SSNJ1YF3SHSR` |

两个稳定版 tool-guard 这次确实读了实现：都用 `rg` 搜索 `node_modules/niceeval/dist/assertions/match.js`，0/3 成立。Canary 丢的 1 分是 Eval 把禁止路径检查装进数组再循环登记。

两个稳定版 GPT Researcher 仍在「根工具项目声明精确候选开发依赖」gate 失败，69 仍是提前停止前登记的分值范围，不能与 98 直接比较。

Canary GPT Researcher 第一次重跑（`@1V21S1YW1EBJC`）为 errored：20 条 Agent Judge 计分项因 Judge 网关返回 Cloudflare 502 而 unavailable，原因是 ZimaCube 节点 01:31 掉线导致 sub2api 不可用（it-infra `memory/sub2api-zimacube-notready-20261115.md`）。第二次（`@1GKSX7Y61QS16`）在 `agent-endpoint` 预检即因网关 502 停止，agent 未运行。网关恢复后第三次得到上表的 passed 77/98。三次中只有最后一次完成了评分路径。

修正后的 Harness 合计：

| 版本 | 原分 | 修正后 |
| --- | --- | --- |
| harness/v0.19.0 | 146/156 | 147/156 |
| harness/v0.20.0 | 150/156 | 151/156 |
| harness/canary | 152/156 | 155/156 |

Install 修正后：DB-GPT 三版均 passed（不变）；GPT Researcher 稳定版两格 failed，canary passed。Canary 的首轮理解仍丢 7 分（接入协议、能力边界、询问 Judge、首跑预算、核心用例），与稳定版的共同缺口一致。
