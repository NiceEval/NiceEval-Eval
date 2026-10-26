# 2026-10-26 OpenSandbox 迁移验收

本次按用户授权运行最新稳定版 `0.19.0` 与 `0.19.1-canary.104`，各含四个 Harness 条件、两道安装题，共 12 格。更早版本不参与矩阵，历史结果保留。用户随后明确要求补跑到全部有分，并检查真实评估中的缓存命中。最终 12/12 格均有完整评分：10 passed、2 failed；不以全绿或满分为重跑条件。

## 运行边界

用户明确接受普通 OpenSandbox/Kata 执行路径，不要求尚未兑现的 `docker/v1` 强生命周期保证。Eval 移除该 capability 声明，保留实际 Docker/Compose 检查和全部业务判据。Kubernetes 异步删除及创建响应丢失的上游限制仍存在，成功运行不能证明强终止保证。

每个 Attempt 请求独立实例、2 CPU / 8 GiB、90 分钟 TTL；整仓并发为 1。固定镜像为 `docker.io/library/niceeval-opensandbox-docker@sha256:ecdce14703f8bf8a7e13d911f945d78e04e469e93b7cf2dca0273888b329b6cb`。宿主 SDK 为 `@alibaba-group/opensandbox@1.1.1`。

早期运行逐次准备 inner runtime、候选与 fixture；后续补跑使用新增 rootfs 准备缓存的宿主候选（核心提交 `e8ec305c5`）。Docker 镜像先导出到 rootfs，停止准备 daemon 并卸载 tmpfs data-root；恢复后启动独立 daemon、导入归档并核对 image ID。缓存不保存进程、内存或挂载卷，不改变被测候选与业务判据；这是一批混合准备环境结果，不为统一批次而重跑已完成部分。

宿主声明依赖 `niceeval@0.19.1-canary.104`；本次实际运行使用此前通过官方 `pnpm dev:link` 安装的本地候选，保留本机 override，不能把它称为发布包验收。沙箱里的被测版本由 Experiment 明确指定。稳定版使用 Query v2，Canary 使用 v3，因此两者的公开字段适配属于当前矩阵所需支持。

Codex 使用既有公网 TLS 模型入口。目标应用的长期凭据只留在宿主，guest 使用 Attempt 级短期代理 token；取消与 teardown 撤销 token、在途请求及 listener。现有 Tailnet 信任规则保留，不把代理绑定地址描述为独占入站接口保证。

## 已发布结果

| 候选 | 用例 | Verdict | 得分 | Attempt |
| --- | --- | --- | --- | --- |
| 0.19.0 | regex-log-authorized | passed | 10/10 | `@180R1R435VW9N` |
| 0.19.0 | cancel-async-authoring | passed | 18/18 | `@168FMSAQTA5QJ` |
| 0.19.0 | log-summary | passed | 10/14 | `@1RC9MQT1N4GSM` |
| 0.19.0 | regex-log | passed | 10/10 | `@1HWN1BQG5730N` |
| Canary .104 | cancel-async-authoring | passed | 18/18 | `@1EM9AT9SZYR96` |
| Canary .104 | log-summary | passed | 11.6/14 | `@135SJW7JXDBTC` |
| Canary .104 | regex-log-authorized | passed | 10/10 | `@1RTDYW6J8B4MG` |
| Canary .104 | regex-log | passed | 10/10 | `@11XFQBTPQ4HFK` |
| Canary .104 | install/db-gpt | passed | 58/99 | `@1S65M11H50NXP` |
| Canary .104 | install/gpt-researcher | failed | 38/86 | `@1DZRDKANTMZKH` |
| 0.19.0 | install/db-gpt | passed | 58/99 | `@10G1Z2FTQCXE9` |
| 0.19.0 | install/gpt-researcher | failed | 25/86 | `@123SDGS5X8MRJ` |

稳定版结果来自 Run `1bae6021-cbb3-4b9b-a4fb-44fce769bacb`。该批次在版本范围澄清期间被中断，已发布结果保留，未发布部分不计为完成。Canary Harness 来自 Run `20c8c52f-ad07-4443-a666-446486bcf3a8`；安装题 Run 为 `4dd8f8a2-bc1b-4f14-9a86-a4d0343df0c9`。

Canary GPT Researcher 首次在 `agent.send` 达到 50 分钟（3,000,000 ms）超时，10 项断言 unavailable；原结果保留，按用户后续“全部有分”的授权补跑。六条 passed 结果已通过公开 `accept` 创建采用记录；errored 结果不允许显式采用，因此仍引用其原 Run。采用后 stable 的 `--dry` 仍报告身份失配，后续运行使用明确选择器排除已完成的授权修复题，避免重复付费。

stable 安装批次 Run `6521e7e8-3968-43db-a068-7994321845fb` 于 09:11–09:24 UTC 执行，两题均因 Codex Responses 入口返回 HTTP 503 结束。DB-GPT `@1TVBM4EJCWHGR` 留有首轮局部证据（3/15、9 项不可用），GPT Researcher `@14CTD61NGDJCE` 尚未产生断言。随后宿主最小 Responses 请求仍返回 HTTP 500，当时未继续启动剩余项。两个服务故障 Attempt 保留，恢复后只补受阻项。该批次结束后 Kubernetes workload Pod、Job、BatchSandbox 和宿主短期代理 listener 均已回收。

10:09 UTC 补跑前，同一模型入口的最小 Responses 请求返回 HTTP 200 并完成生成，随后启动缺分项。真实 Harness 新实例 `c5ad33e1-c031-4207-b60b-dfb5e03eebb0` 从快照 `43b7b309-8cfe-4e37-a154-b1301ad4eadf` 对应镜像启动；该快照早在 09:02:33 UTC 已创建。证据来自 Kubernetes workload 镜像与运行前 Snapshot 清单，证明跨 Invocation 使用既有缓存，而非仅凭耗时推断命中。

stable authoring 与 log-summary 补跑 Run 为 `0fbe1de3-6978-4541-81a3-0c014a54f703`，两项评分均 complete。第二个实例 `bb828fd5-67d5-4909-b1d1-f3aec9eaec22` 也使用同一旧快照。公开 `show @168FMSAQTA5QJ --execution --expand command_000000dbh172h02z7xa7kp785g` 显示第一条准备命令直接启动 Docker、从归档导入三组 runtime tag，并逐项核对 image ID，退出码 0；没有重建该准备层。两个独立实例均完成实际评估。

stable regex-log 补跑 Run `531d85de-42e8-4b8d-9fbf-64e103ee0fc4` 得到完整 10/10，实例 `0cda97d4-8106-4f40-9122-929229fd63f3` 同样从 `43b7b309…` 快照启动。补跑命令曾传入 CLI 80 分钟，但 Eval 的显式 timeoutMs 优先，因此实际仍为 50 分钟；此前将 CLI 参数描述为已生效不准确。

安装题补跑实例 `dd221f36-e04d-40d1-8368-0e4e44f0d2b3` 使用 runtime 快照 `23a6c434-fc74-477b-bff0-b480d9ba2d0f`，创建时间为 08:59:25 UTC；它与 Harness 的候选安装快照不同。从零安装题仅恢复公共 runtime，不继承 Harness 候选项目。Invocation 摘要的 `beforeCaches` 计数没有显示这些 Provider 命中，因此缓存验收使用实际快照身份与公开命令记录，不以该计数或总耗时作单独证据。

stable DB-GPT 补跑来自 Run `f90015c1-7de4-4fc7-ba3a-f990aeeb303e`，公开 Query 确认 58/99、score.state=complete。收尾工作区 diff 因 `OpenSandbox is stopped` 未能导出，部分命令捕获受限；这项证据缺口不改写为完整 diff，也不把完整评分等同于全部观察材料完整。随后 GPT Researcher 使用独立实例 `c986d511-de1f-4095-b329-1b99ca6aece9`，再次命中相同 runtime 快照。

`log-summary` 的只读边界检查均 matched：没有新发布 Run、没有读取私有结果、Turn 成功、工作区保持不变。得分中 `classifier-debug` 最终事实为 0/2、公开证据完整性为 1.6/2；其余四项合计 10/10。因此 passed 不等于所有评分项满分。

Canary DB-GPT 的真实运行与真实响应两项 gate 均 satisfied，46 项断言无 unavailable。得分分组为：文档与首轮理解 5/15、其它 7/7、Adapter/Experiment/Eval 源码设计 27/54、判据可读性 4/5、真实运行与公开证据 15/18。保留 58/99 的实际表现，不为提高分数重跑。

Canary 两个 regex-log 条件的 `changed-only-config` 范围断言为 unavailable（`source-unavailable`），其它十项均 matched。稳定版授权修复题的范围断言也为 unavailable。另行检查这三次 Attempt 的公开 `show --diff`，complete diff 均无 limitations，只包含 `experiments/local.ts` 一处 modified。这是独立范围证据，不能把原断言改称为 matched；对应观察已记录到 NiceEval 本地 Issue 草稿 `docs/issues/changed-paths-source-unavailable.md`（提交 `ff22abc59`）。

## 公开取证与限制

所有运行证据通过仓库的 `pnpm --silent exec niceeval query discover`、固定 Run/Attempt 的 Query 请求及 `niceeval show` 读取，未读取或改写私有 Record 文件。保留失败、中断与已完成的 Attempt；不为凑齐全绿重跑合法业务失败。费用缺失保持 unavailable，不补零，也不以外层 Judge 的局部 usage 代表全部模型费用。

CLI JSON progress 只提供数量，运行中的 `run.get` 不能区分 pending 成员中正在执行的 Eval 或阶段。此缺口已用发布包 .104 的无模型、无沙箱最小例子复现：两个串行 45 秒 Eval，运行时均 pending，最终 2/2 passed。NiceEval 本地 Issue 草稿 `docs/issues/live-attempt-progress.md` 已提交为 `646800bb0`；受管远端 plan 因 `IssueRemoteBudgetExceeded` 失败，未创建远端 Issue。

## 契约验证

迁移源码最终 `pnpm typecheck` 通过，`pnpm test` 8/8 通过。无模型调用的真实 OpenSandbox 验收复制本仓库 `harnessSandbox('0.19.0')` 准备流程：冷启动 `@1CG5PD10C43FX`（约 333 秒）与热启动 `@1H440M27AAJ47`（约 51 秒）均通过镜像归档、三组 tag/image ID、嵌套 Node/Python 容器和候选版本检查。宿主候选通过正式 pack 产出并独立安装，tarball SHA-256 为 `59c1d58aa3b36fdd7f276420ab5cf4c715f69dd3158a70d40f61ad05e0ec3b91`；此探针不计入付费文档矩阵。

独立临时项目安装发布包 `niceeval@0.19.0`，复制仓库现有的 `test-query.ts`、`test-judge-retention.ts`、`lib/judge.ts` 与保留 v2/v3 的 Query helper，执行 `pnpm exec tsx --test scripts/test-query.ts scripts/test-judge-retention.ts`：2/2 通过。前者验证当前结果、局部修复、沿用及判据失效，后者通过本地裁判 HTTP fixture 验证 34 项评分与材料留存；均不调用真实模型。它验证稳定版支持的必要性，不替代 OpenSandbox 的真实安装题验收。

另将迁移源码复制到临时项目，连接已独立安装的发布包 `niceeval@0.19.1-canary.104`。本地 `niceeval --version` 确认 .104；执行 `tsx scripts/typecheck.ts` 和上述两个真实 CLI 契约测试，类型检查通过、2/2 测试通过。补齐临时项目的 `sandbox/harness-project` seed 后，发布 CLI 的 `exp --dry --json` 完整识别 4 个 Experiment、6 道 Eval、12 格，退出码 0。此项验证发布包消费兼容性，不把正在运行的本地候选批次改称为发布包批次。

## 中断与长耗时调查

稳定版 GPT Researcher 补跑 @123SDGS5X8MRJ 完成评分 25/86，保留业务失败。公开 timing 显示 sandbox.prepare 31.64 秒，两轮 agent.send 分别 1167.63 与 1228.32 秒。通过 show --execution 的 continuation 读完 251 条事件，可见依赖安装、配置错误修复、服务重建及多轮内部评估。早期 NameError 后来已修复，不能把它当成最终故障；目前没有证据证明 Runner 死锁。

失败 gate 的 assertion.detail 明确承认 execution 中有真实报告与引用；判 N 的原因是助手消息来自 path 指向的 Markdown artifact，而既定 rubric 要求来自 report 帧。材料 coverage=complete；这不是 trace 缺失导致的评分。内部评估 passed 与外层 gate failed 分属不同判据，不修改历史分数。

SIGINT 样本 Run 1bae6021-cbb3-4b9b-a4fb-44fce769bacb 的进行中成员 publication absent、interrupted-before-publication，没有 locator；已完成成员仍可读。超时 @15RN8P2GBDACE 可读第一轮，但第二轮 interrupted 只留 user message，完整 timing 也没有第二轮 activity。公开入口不足以定位其后约 44 分钟等待位置。已用 concord 记录核心 Issue 草稿 interrupted-attempt-trace-evidence，关联已有远端 #126；未更新远端 Issue。

调查后仅补跑 Canary GPT Researcher，明确将该 Eval 的 timeoutMs 改为 80 分钟，仍低于实例 90 分钟 TTL。此变更提供执行预算，不声称修复中断证据缺口，也不改评分 rubric。补跑前 dry plan 确认 total=1、reused=0；新实例 717c03a2-694e-400e-9d17-7d0591d50436 继续命中已有 runtime 快照 23a6c434。11 个既有 locator 经固定 attempt.get 请求复核，均为 score.state=complete（10 passed、1 failed）。

## 最终补分与回收

Canary GPT Researcher 最终 Run 43c87d50-4733-4f8b-9424-f9e884119e6f 于 12:02:57–12:56:27 UTC 完成，用时约 53.5 分钟。Attempt @1DZRDKANTMZKH 为 failed、38/86、score.state=complete；没有再次超时。公开 timing 显示 sandbox.prepare 32.45 秒、两轮 agent.send 分别 1077.95 与 1725.65 秒。该结果不证明旧超时样本的根因，也不消除中断 trace 缺口。

公开 assertion.detail 中 target-response gate 的裁判理由是：正向 Apollo 11 研究只返回无法收集来源，没有实质报告与引用；预置报告问答虽有事实与引用，但不是该核心研究任务的输出。保留这一业务失败。部分 assertion material 被截断（12 与 573694 bytes），execution/diff/usage 也有 partial；完整评分不代表全部材料完整，费用仍 unavailable。

全部 12 个 locator 已通过固定 attempt.get 请求确认评分 complete。收尾 Kubernetes opensandbox-workloads 的 Pod、Job、BatchSandbox 均为空，宿主 18180 端口无 listener。无本轮 pane、tab 或 worktree 残留。Eval 时限修改的 pnpm typecheck 与 git diff --check 通过；Issue 草稿所在核心仓库 concord check 及推送前 lint 通过。

最终复用检查：exp --dry 显示 total=12、reused=4。对其余 8 个完整评分 locator 执行 accept 均成功，紧接着 dry 仍只复用 4 格；其余依旧 identity-mismatch。该既有产品缺口已追加到核心 docs/issues/accept-current-plan-identity-mismatch.md。12 格历史分数均可按上表 locator 读取，不把 gap 视为无结果，也未因此重复付费；在此问题修复前不要直接用全量默认运行补 gap。
