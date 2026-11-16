# 2026-11-16：Cloudflare Access 配置修复后的 Install 重跑

用户更新网关凭据并授权重跑三个正式版本的安装题。本轮仅运行 `install/v0.19.0`、`install/v0.20.0`、`install/v0.21.0`，每个版本五格，共 15 格（包括三个 ComfyUI 占位格）；不重跑 Harness。

## 环境与修复

- 本仓库实现提交：`4ab4978`。四题的 gate 保留 `5b24b9c` 对 null locator 的修复。
- 执行器实际是本地链接的 NiceEval development 包，运行开始时核心仓库 HEAD 为 `64bd2e49acb5dfc3501628461397c217e1d00b08`；被测候选仍是三个 npm 正式版。
- 网关现在要求 Cloudflare Access Service Token。不带 CF 请求头的 `/models` 请求返回 403；带头返回 200。
- `codexAgent` 和 `OpenAIProvider` 通过公开 `headers` 参数注入 CF 请求头；启动探测复用同一读取函数。两项 CF 环境变量必须成对提供。
- 目标应用凭据文件增加 `OPENAI_EXTRA_HEADERS` JSON。模拟用户告知被测 agent 从该文件读取并发送请求头；LLM X 的内层 Judge 也使用同一文件中的模型与请求头。凭据值不写入源码。
- 本机 `.env` 的 `TARGET_APP_MODEL` 从不存在的 `deepseek-v4-1-flash` 修正为网关公布的 `deepseek-v4.1-flash`。前者真实请求返回 404 `model_not_found`；后者 Chat Completions 与 Responses 均返回 200 和真实文本。外层 `gpt-6.1-sol`、`gpt-6-astra` 的带 CF 请求也均返回真实文本。
- `pnpm run typecheck`、`git diff --check` 通过；直接调用凭据准备函数验证了头字段写入及 CF 缺项拒绝行为。

## 运行入口

```sh
export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"
pnpm --silent exec niceeval exp \
  --experiment install/v0.19.0 \
  --experiment install/v0.20.0 \
  --experiment install/v0.21.0 \
  --rerun all --no-pause --json
```

执行前同样选择器的 `--dry` 确认 15 格。Invocation：`s_b0ec4bd2-4366-4c8f-a6b1-7e5930a4f9a2`。

| 候选 | Run ID |
| --- | --- |
| v0.19.0 | `329e7613-a858-4691-b6b7-676ae8f01cb2` |
| v0.20.0 | `1c964c2f-24ad-43e7-a8cb-cb1cf2211157` |
| v0.21.0 | `6773dbf9-6995-45e4-9dd4-d6d40a5bc616` |

运行日志留在本机忽略目录 `.agent-output/cf-install-20261116/`。结果读取使用公开 `show ... --json`，运行状态使用 `invocation show`；现场使用 Instabox CLI 只读检查，不修改被测沙箱。

## 结果

Invocation 在 UTC `02:01:04` 开始、`02:26:00` 完成，约 24 分 56 秒。CLI 退出码为 1，最终收据为 **0 passed、2 failed、11 errored、2 skipped**；三个 Run 各发布五个成员。before cache 31/31 命中，无重建或降级。收据估算费用为 $6.73，不是账单实付。

| 题目 | v0.19.0 | v0.20.0 | v0.21.0 |
| --- | --- | --- | --- |
| DB-GPT | errored `@1XH3F6EXDH0P3` | errored `@1F84AC6SR1P2D` | errored `@10T7W1XM7KDR7` |
| GPT Researcher | errored `@1Y5S7WNW0YFQ2` | errored `@19BCCA1JGVE3N` | errored `@17K6FX279379E` |
| Concord | errored `@1VNTG9Q2ZT95N` | errored `@1HB4V57GGCNWA` | errored `@1TC34JDB8Q87C` |
| LLM X | failed，20/59，`@1JGP1HBQG6ARX` | failed，20/59，`@1RTR8YEEDGRT4` | errored `@151TWFDGS5XQ0` |
| ComfyUI | skipped `@12148XH9ASRHG` | skipped `@175HBCGQ4KQ08` | errored `@1S70HVV0N0CA0` |

### 环境错误

三个版本的 DB-GPT、GPT Researcher、Concord，共九格，都在外层 Codex `/responses` 收到 502 后失败，公开诊断为 `agent-send-failed`。故障集中在 UTC `02:22` 附近。LLM X v0.21.0 另有八项 Judge 证据 unavailable，公开断言的 `failureEvidence` 明确为 Cloudflare 502 `origin_bad_gateway`：源站返回无效或不完整响应。其 `dry plan 成功` gate 同时未通过，不能从这个 errored Attempt 得出完整产品结论。

ComfyUI v0.21.0 在准备阶段探测超时（curl exit 28、HTTP 000），未进入占位题的 skip。其余两个占位格正常跳过。

故障前一次最小 `/responses` 请求虽返回 200，但耗时约 38 秒；故障后的三条 Chat Completions 小请求（外层 agent、judge、目标模型）均在约 2.6–3.8 秒恢复 200。这只说明复查时可用，不足以证明长会话稳定，因此本轮没有再整批重跑。若继续补跑，应保留两个已完成 LLM X 的失败事实，只处理受环境影响的格。

八格出现 `telemetry-budget-exceeded` 警告：收集超过 30 秒预算，保留已有 trace 与 verdict。这不是覆盖或修正 502 错误的依据。

### 可解释的失败

LLM X v0.19.0 与 v0.20.0 都完成了判分，各为 20/59。公开断言 `实际运行取得 live 应用真实响应` 的 Judge 取证指出：作者实验固定 `PROVIDER_MODE=fixture`，真实 HTTP 请求最终进入 `FixtureProvider`；文字由固定模板拼接，图片是本地 SVG data URL。虽然内层自写 Eval passed、业务断言通过，却没有 live 模型响应，所以按既定 gate 判 failed。此结论不依赖故障期间未完成的其他格，也不能当作三个版本的整体排名。

## 判分耗时比较口径

此前[验收记录](validation-2026-11-15.md)记载：旧串行判分的 DB-GPT v0.21.0 `@1N5A7NSBKP9C2` 总耗时约 31 分钟，其中 agent 两轮 13.5 分钟、`assertions.evaluate` 13.9 分钟。该旧格式 Attempt 当前 CLI 无法定位；本轮仅引用已归档文档中的数字，不读取私有文件补证。

比较采用公开 timing 的 `assertions.evaluate` 墙钟耗时，不把并发 Judge 子区间相加，也不把不同运行的时间差全归因于并行化。模型服务延迟、题目与 agent 产物都会影响耗时。

本轮 LLM X v0.20.0 的公开 timing 给出 `assertions.evaluate = 169334 ms`（约 2.82 分钟）。但旧记录的 13.9 分钟属于 DB-GPT，而本轮 DB-GPT 全部受 502 影响；没有可比的正常完成样本，**本轮无法验收判分提速幅度**。

## 后续与资源

代码修复和类型检查已完成；安装矩阵的有效完整验收仍被网关长会话稳定性阻塞。未发布 NiceEval，也未操作生产环境。公开 `invocation list --json` 返回空 sessions/expired；Instabox 按本轮三个 Run ID 筛选无残留实例。没有创建 Herdr worker、pane、tab 或额外 worktree；本轮 terminal/pane/tab/worktree 残留：无。

## 补跑：网关源站间歇不可用（同日）

用户确认 deepseek、CF 等配置就绪后，按默认规则补跑（不加 `--rerun`；errored 与 skipped 重跑，两个 LLM X failed 沿用）。

| 轮次 | Invocation | 并发 | 时长 | 结果 | 估算费用 |
| --- | --- | --- | --- | --- | --- |
| 补跑 1 | `s_3158fbbc-ad6e-4b2d-94e5-e0ab779b7839` | 10 | 约 2 分钟 | 11 errored、2 skipped | 未计 |
| 补跑 2 | `s_73c74aed-b7b1-43cc-82d8-0ed2d4af2232` | 3（`--max-concurrency 3`） | 约 46 分钟 | 11 errored、2 skipped | $2.06 |

补跑 1 全部在第一个 turn 收到 Cloudflare 502。排查时：本机与临时 Instabox box 内单发 `/responses`、流式请求与 10 路小请求并发均为 200；但 10 路约 100 KB instructions 的大请求并发时，首字节延迟 50–150 秒，5/10 超过 Cloudflare 100 秒上限返回 524。据此判断源站在并发长上下文下吞吐不足，补跑 2 降到 3 路并发。

补跑 2 仍全部 errored，错误换成源站不可达：五格准备阶段探测拿到 HTTP 530（Cloudflare 连不上源站）或连接超时（curl exit 28），三格 Codex turn 收到 530，两格流在完成前断开（`error decoding response body`）。故障期间网关时好时坏，事后 `/models` 立即恢复 401。这已不是并发问题，而是网关源站或其 Cloudflare 隧道间歇掉线；评估代码、CF 凭据与目标模型配置均未发现问题。

在网关源站稳定前不再补跑。恢复后重新执行同一命令（建议保留 `--max-concurrency 3`），errored 格会自动重跑。临时探测 box `ne-gw-probe` 已删除；无 terminal/pane/tab/worktree 残留。
