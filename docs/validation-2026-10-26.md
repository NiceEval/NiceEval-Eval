# 2026-10-26 OpenSandbox 迁移验收

本次按用户授权运行最新稳定版 `0.19.0` 与 `0.19.1-canary.104`，各含四个 Harness 条件、两道安装题，共 12 格。更早版本不参与矩阵，历史结果保留。以下为进行中的记录，未列出完整结果前不代表全范围验收完成。

## 运行边界

用户明确接受普通 OpenSandbox/Kata 执行路径，不要求尚未兑现的 `docker/v1` 强生命周期保证。Eval 移除该 capability 声明，保留实际 Docker/Compose 检查和全部业务判据。Kubernetes 异步删除及创建响应丢失的上游限制仍存在，成功运行不能证明强终止保证。

每个 Attempt 请求独立实例、2 CPU / 8 GiB、90 分钟 TTL；整仓并发为 1。固定镜像为 `docker.io/library/niceeval-opensandbox-docker@sha256:ecdce14703f8bf8a7e13d911f945d78e04e469e93b7cf2dca0273888b329b6cb`。宿主 SDK 为 `@alibaba-group/opensandbox@1.1.1`。

先完成的 7 格逐次准备 inner runtime、候选与 fixture；后续 5 格使用新增 rootfs 准备缓存的宿主候选（核心提交 `e8ec305c5`）。Docker 镜像先导出到 rootfs，停止准备 daemon 并卸载 tmpfs data-root；恢复后启动独立 daemon、导入归档并核对 image ID。缓存不保存进程、内存或挂载卷，不改变被测候选与业务判据；这是一批混合准备环境结果，不为统一批次而重跑已完成部分。

宿主声明依赖 `niceeval@0.19.1-canary.104`；本次实际运行使用此前通过官方 `pnpm dev:link` 安装的本地候选，保留本机 override，不能把它称为发布包验收。沙箱里的被测版本由 Experiment 明确指定。稳定版使用 Query v2，Canary 使用 v3，因此两者的公开字段适配属于当前矩阵所需支持。

Codex 使用既有公网 TLS 模型入口。目标应用的长期凭据只留在宿主，guest 使用 Attempt 级短期代理 token；取消与 teardown 撤销 token、在途请求及 listener。现有 Tailnet 信任规则保留，不把代理绑定地址描述为独占入站接口保证。

## 已发布结果

| 候选 | 用例 | Verdict | 得分 | Attempt |
| --- | --- | --- | --- | --- |
| 0.19.0 | regex-log-authorized | passed | 10/10 | `@180R1R435VW9N` |
| Canary .104 | cancel-async-authoring | passed | 18/18 | `@1EM9AT9SZYR96` |
| Canary .104 | log-summary | passed | 11.6/14 | `@135SJW7JXDBTC` |
| Canary .104 | regex-log-authorized | passed | 10/10 | `@1RTDYW6J8B4MG` |
| Canary .104 | regex-log | passed | 10/10 | `@11XFQBTPQ4HFK` |
| Canary .104 | install/db-gpt | passed | 58/99 | `@1S65M11H50NXP` |
| Canary .104 | install/gpt-researcher | errored | 评分不可用 | `@15RN8P2GBDACE` |

稳定版结果来自 Run `1bae6021-cbb3-4b9b-a4fb-44fce769bacb`。该批次在版本范围澄清期间被中断，已发布结果保留，未发布部分不计为完成。Canary Harness 来自 Run `20c8c52f-ad07-4443-a666-446486bcf3a8`；安装题 Run 为 `4dd8f8a2-bc1b-4f14-9a86-a4d0343df0c9`。

Canary GPT Researcher 在 `agent.send` 达到 50 分钟（3,000,000 ms）超时，10 项断言 unavailable；保留该结果，不为通过而重跑。六条 passed 结果已通过公开 `accept` 创建采用记录；errored 结果不允许显式采用，因此仍引用其原 Run。采用后 stable 的 `--dry` 仍报告身份失配，后续运行使用明确选择器排除已完成的授权修复题，避免重复付费。

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
