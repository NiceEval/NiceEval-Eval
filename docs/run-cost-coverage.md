# 运行费用覆盖与止损

2026 年 11 月 25 日 UTC 的 canary 批次共发布 29 格，被测候选为 `0.22.2-canary.134`。其中 28 格有槽位估价，合计 **$9.203**。公开用量另有 **876 次未计价的 Judge 调用**和 **4 次未计价的模拟用户调用**。Provider 实付、内层模型调用和 Instabox 账单仍缺证据。

| 实验 | Run ID | 已发布 / 计划 |
| --- | --- | ---: |
| Harness | `ebae4da8-7767-411e-9ca2-ac6b06700e47` | 24 / 24 |
| Install | `4aad30fb-0ecc-4936-9404-eea42ceb1293` | 5 / 5 |

Invocation `s_8ef1683a-286e-4983-b34c-f8961ec18e5f` 的墙钟时间为 38 分 52.501 秒。下表的 Install 分母包含 ComfyUI 占位格。两个 Run 与 Invocation 的分母、候选、费用及时间都可用下文命令复算。

> **2026-11-28 起 Judge 不再整体缺价。** NiceEval 的 Judge 内置目录估价（commit `feat(judge): estimate missing call costs from the built-in catalog`）让 Judge 与模拟用户在没有供应商报告费用和 `defineConfig.pricing` 时按内置目录估价，`gpt-6.2-sol` 为输入 $2、输出 $10 每百万 token。同日日常初筛 Run `01f7199a-ab85-45ab-bb53-21d363d8b59f`（6 格，`0.22.2-canary.135`）6/6 passed，槽位估价合计约 $1.27，墙钟 10 分 24 秒。抽查 `show @1RFTGK2Q99CWR usage --json`：Judge 10 次调用全部估价，合计 $0.0125，状态仍为 partial（`token-buckets-incomplete`），application 仍为 `usage-not-recorded`。11 月 25 日的历史账本不改写，需要时按[按历史价目试算](#按历史价目试算)重计价。

## 按题型与端点查看费用覆盖

| 题型 | 有槽位估价 / 总格数 | 槽位估价 USD | 外层 Codex 上报请求 | Judge 有价 / 未计价 | 模拟用户未计价 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Harness 除 `concord-rsi` 外 | 23 / 23 | 3.681 | 225 | 0 / 189 | 0 |
| Harness `concord-rsi` | 1 / 1 | 0.634 | 43 | 0 / 97 | 0 |
| **Harness 小计** | **24 / 24** | **4.315** | **268** | **0 / 286** | **0** |
| Install DB-GPT | 1 / 1 | 1.341 | 63 | 0 / 167 | 1 |
| Install GPT Researcher | 1 / 1 | 1.843 | 88 | 0 / 133 | 1 |
| Install Concord | 1 / 1 | 0.799 | 47 | 0 / 150 | 1 |
| Install LLM X | 1 / 1 | 0.905 | 58 | 0 / 140 | 1 |
| Install ComfyUI（占位） | 0 / 1 | 缺失 | 缺失 | 0 / 0 | 0 |
| **Install 小计** | **4 / 5** | **4.888** | **256** | **0 / 590** | **4** |
| **批次合计** | **28 / 29** | **9.203** | **524** | **0 / 876** | **4** |

各端点按仓库的配置入口标识。公开 Record 的槽位估价取 `costUSD.value`，有值的项均标为 `estimated`。外层 Codex 请求数取 `usage.totals.requests.value`，保留为 Adapter 上报量。

- **外层 Codex**走 Responses，两个 Run 的模型均为 `gpt-6.1-sol`。外层连接优先取 `CODEX_BASE_URL`。这批 28 格有请求数，但 `usage.totals.providerCosts` 均无费用值。 [沙箱配置](../lib/sandbox.ts) · [网关历史记录](validation-2026-11-16.md#环境错误)
- **外层 Judge 与模拟用户**共用项目的 `CODEX_BASE_URL` Provider，模型配置为 `gpt-6.2-sol`。Judge 数包含普通 Judge 和 Agent Judge，按公开明细的物理传输计数，`transportProvider=openai`。876 次都缺 `gpt-6.2-sol` 的价目，原因为 `judge / no-pricing-profile`。四个有效 Install 各报告一次 `simulated-user / provider-cost-not-reported`。表里的模拟用户 0 表示该行没有公开记录的未计价调用。 [Judge 配置](../niceeval.config.ts)
- **内层目标应用**的用量计数不可得。29 格都列出 `application / usage-not-recorded`，其中也包括占位格和只用 fixture 的题。Install 的 DB-GPT、GPT Researcher 和 Concord 通过 `TARGET_APP_OPENAI_BASE_URL` 配置目标模型出口。LLM X 的文字和图片使用 `CODEX_BASE_URL`，内层 Judge 另用 `TARGET_APP_OPENAI_BASE_URL` 的 Chat Completions。Harness 的 `concord-rsi` 优先使用齐备的 `CONCORD_RSI_*` 配置，否则沿用 `TARGET_APP_*`。这些配置说明请求可走的端点，实际调用次数与费用留空。 [目标应用连接](../lib/target-app-env.ts) · [LLM X 题面](../evals/install/llm-x/eval.ts) · [Concord RSI 连接](../evals/harness/trace/concord-rsi/target-app-env.ts)

金额只在同一口径内加总。槽位估价与 `usage` 的费用字段覆盖范围不同，无法用两者的差额补齐 Judge、模拟用户或目标应用费用。11 月 21 日约 $73 的数字是整个 Codex key 的当日账单，无法从日总额倒算 Run 或端点费用。归账需要账单明细与调用归属。 [11 月 21 日模型对比](model-comparison-2026-11-21.md)

## Instabox 实例耗时

表中单位为秒。每格各取一次 `timing` 的三个根活动，再按格加总。`duration` 是 Run 的 `plannedAttempts[].durationMs.value`。它已覆盖槽位生命周期里的子阶段。并行执行时，将各格相加得到累计槽位时长，批次墙钟从 Invocation 的起止时间读取。

| 题型 | `sandbox.create` 合计 | `sandbox.prepare` 合计 | `agent.install` 合计 | 槽位 `duration` 合计 | 最长槽位 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Harness 除 `concord-rsi` 外 | 186.392 | 565.192 | 31.256 | 3335.989 | 326.728 |
| Harness `concord-rsi` | 9.409 | 33.880 | 1.203 | 938.713 | 938.713 |
| **Harness 小计** | **195.801** | **599.072** | **32.459** | **4274.702** | **938.713** |
| Install DB-GPT | 6.223 | 29.495 | 1.093 | 1008.556 | 1008.556 |
| Install GPT Researcher | 8.434 | 26.237 | 1.473 | 1556.013 | 1556.013 |
| Install Concord | 9.360 | 39.899 | 1.519 | 650.302 | 650.302 |
| Install LLM X | 8.058 | 19.552 | 1.157 | 1205.946 | 1205.946 |
| Install ComfyUI（占位） | 8.144 | 19.278 | 1.572 | 41.673 | 41.673 |
| **Install 小计** | **40.219** | **134.461** | **6.814** | **4462.490** | **1556.013** |
| **批次合计** | **236.020** | **733.533** | **39.273** | **8737.192** | **1556.013** |

三项阶段时长已经包含在槽位 `duration` 中，叠加会重复计算。同样，每个根活动已经包含其子活动。实例计费还需要 Provider 的计费窗口、回收状态和费率。

## 复算固定批次

从仓库根目录执行。脚本只读公开 CLI。先从 Run 取得已发布 locator，再读取每格的 `usage` 与 `timing`。Judge 分页按公开链接补齐，并用全量计数检查是否漏掉明细。脚本输出的费用列依次是有估价格数、总格数、估价美元、Codex 请求数、带价格的 Judge 数、未计价 Judge 数、未计价模拟用户数。耗时列的顺序与上表相同。

```sh
export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"
python3 - <<'PY'
import json
import shlex
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

def ne(*args):
    return json.loads(subprocess.check_output(
        ["pnpm", "--silent", "exec", "niceeval", *args, "--json"]
    ))

run_ids = [
    "ebae4da8-7767-411e-9ca2-ac6b06700e47",
    "4aad30fb-0ecc-4936-9404-eea42ceb1293",
]
slots = []
for run_id in run_ids:
    run = ne("show", f"run:{run_id}")["run"]
    execution = run["value"]["context"]["execution"]
    print(run_id, run["denominator"], execution["flags"]["candidateVersion"], execution["model"])
    slots.extend(run["plannedAttempts"])

session = ne("invocation", "show", "s_8ef1683a-286e-4983-b34c-f8961ec18e5f")["session"]
wall = datetime.fromisoformat(session["completedAt"]) - datetime.fromisoformat(session["startedAt"])
print("Invocation", wall.total_seconds(), "s")

phases = ("sandbox.create", "sandbox.prepare", "agent.install")

def read_slot(slot):
    loc = slot["publication"]["attemptLocator"]
    document = ne("show", loc, "usage")
    usage = document["usage"]
    judge = usage["judgeUsage"]
    calls = list(judge["calls"])
    while judge["omittedCallCount"]:
        command = next(link["command"] for link in document["links"] if link["rel"] == "next-page")
        document = ne(*shlex.split(command)[1:])
        judge = document["usage"]["judgeUsage"]
        calls.extend(judge["calls"])
    assert len({call["callId"] for call in calls}) == len(calls) == judge["totals"]["costs"]["totalCalls"], loc
    priced = sum(call["cost"] is not None for call in calls)
    sim = usage["totalCosts"].get("simulatedUser") or {}
    roots = [activity for activity in ne("show", loc, "timing")["timing"]["activities"]
             if activity["parentActivityId"] is None and activity["label"] in phases]
    assert Counter(activity["label"] for activity in roots) == Counter(phases), loc
    phase_ms = {activity["label"]: activity["durationMs"] for activity in roots}
    return {
        "eval": slot["evalId"], "loc": loc, "estimate": slot["costUSD"].get("value"),
        "requests": usage["totals"]["requests"]["value"], "priced": priced, "unpriced": len(calls) - priced,
        "sim": sim["calls"] if sim.get("state") == "unpriced" else 0,
        "duration": slot["durationMs"]["value"], "phase_ms": phase_ms,
        "gaps": [(gap["source"], gap["reason"], tuple(gap["models"])) for gap in usage["totalCosts"]["gaps"]],
        "judge_routes": {(call["transportProvider"], call["model"]) for call in calls},
        "provider_costs": usage["totals"]["providerCosts"]["values"],
    }

with ThreadPoolExecutor(max_workers=4) as pool:
    rows = list(pool.map(read_slot, slots))
harness = [row for row in rows if row["eval"].startswith("harness/")]
install = [row for row in rows if row["eval"].startswith("install/")]
rsi = [row for row in harness if row["eval"] == "harness/trace/concord-rsi"]
groups = [("Harness 除 concord-rsi 外", [row for row in harness if row not in rsi]),
          ("Harness concord-rsi", rsi), ("Harness 小计", harness)]
groups += [(row["eval"], [row]) for row in install]
groups += [("Install 小计", install), ("批次合计", rows)]

for label, group in groups:
    estimates = [row["estimate"] for row in group if row["estimate"] is not None]
    count = lambda name: sum(row[name] or 0 for row in group)
    print(label, "费用", len(estimates), len(group), f"{sum(estimates):.3f}" if estimates else "缺失",
          count("requests") if any(row["requests"] is not None for row in group) else "缺失",
          count("priced"), count("unpriced"), count("sim"))
    longest = max(group, key=lambda row: row["duration"])
    timings = [sum(row["phase_ms"][phase] for row in group) for phase in phases]
    print(label, "秒", *(f"{value / 1000:.3f}" for value in [*timings, count("duration"), longest["duration"]]),
          longest["loc"])

print("费用缺口及出现格数", Counter(gap for row in rows for gap in row["gaps"]))
print("Judge 传输与模型", set().union(*(row["judge_routes"] for row in rows)))
print("Provider 返回费用的格数", sum(bool(row["provider_costs"]) for row in rows))
PY
```

### 按历史价目试算

`niceeval show --help` 列出 `usage --reprice <file>`。拿到可靠的网关价目后，把适用网关、模型 ID、币种、单位、缓存费率和生效日期与价目文件一起记录。这个批次应使用覆盖 2026 年 11 月 25 日 UTC 的网关费率。以 GPT Researcher 的固定 Attempt 为例，对照两次输出中的 `usage.totalCosts`、`usage.judgeUsage.totals.costs` 和费用缺口。

```sh
export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"
pnpm --silent exec niceeval show @14JE0YC5CZSXY usage --json
pnpm --silent exec niceeval show @14JE0YC5CZSXY usage --reprice pricing.json --json
```

本批的实际网关费率未核实，因此这里只列试算方法。Reprice 依赖已记录的用量与适用费率。若缺的是 `usage-not-recorded`，新增价目也无法补齐采集。试算值仍是估价，账单实付需要 Provider 收据。

## 并发、超时与停跑条件

当前全局并发上限为 **10**，单次 Attempt 默认 **20 分钟**。Eval 的显式 `timeoutMs` 优先于全局与 CLI 超时。Instabox 的实例寿命为 **90 分钟**。下表按当前配置列出分题超时。

| 超时 | Eval（ID 省略族前缀） |
| ---: | --- |
| 15 分钟 | `rerun-scope`、`errored-triage`、`regression-triage`、`trace/trace-flaky-cause`、`trace/trace-order-swap`、`trace/trace-token-spike`、`trace/trace-slow-assertion`、`trace/trace-swallowed-error`、`trace/trace-slow-turn`、`trace/trace-wrong-argument` |
| 20 分钟 | `organize-refund`、`flaky-check`、`tool-guard`、`terminal-bench/log-summary`、`terminal-bench/classifier-pressure`、`trace/triage-at-scale`。Install 的 `comfyui` 沿用默认值。 |
| 25 分钟 | `multiturn-authoring`、`terminal-bench/regex-log` 与 `terminal-bench/regex-log-authorized`、`trace/fix-flaky-eval`、`trace/author-hitl-cancel` |
| 30 分钟 | `terminal-bench/cancel-async-authoring`、`terminal-bench/log-summary-repair` |
| 80 分钟 | Install `db-gpt`、`gpt-researcher` |
| 85 分钟 | Install `llm-x`、`concord`，Harness `trace/concord-rsi` |

```sh
rg -n 'maxConcurrency:|timeoutMs: [0-9]+ \* 60 \* 1000|lifetimeMs:' \
  niceeval.config.ts lib/sandbox.ts experiments evals
rg -n 'score|recovery' evals/harness/terminal-bench/regex-log{,-authorized}/eval.ts
```

保留分题上限。11 月 25 日 Harness 最长槽位为 `concord-rsi` 的 938.713 秒（15.65 分钟），Install 最长为 GPT Researcher 的 1556.013 秒（25.93 分钟）。两者都是单批次观测。较早的 GPT Researcher 曾在 50 分钟处超时，另一次完整槽位约 53.5 分钟。调整单题预算时用可比的完整样本和阶段耗时，并为接近实例寿命的题保留收尾时间。 [GPT Researcher 历史验证](validation-2026-10-26.md)

1. 已获授权的常规 Harness 保留全局上限 10。用 `niceeval invocation show <invocation-id> --json` 定位进度异常的格。已发布格用 `niceeval show @<locator> execution --json` 或 `usage --json` 追到出错端点，先读该格的实际错误。
2. 安装题、Judge 密集题或内层服务出现可归因的 HTTP 429 时，先看退避和队列是否恢复。若限流持续，停下受影响的批次，再用较低的 `--max-concurrency` 执行已获授权的剩余格。按实际端点和账号负载选值，并记录覆盖值。槽位内有并发 Judge，槽位上限只是请求并发的一层限制。
3. 同一共享端点反复出现 5xx，或已经确认整批受同一个网关、凭据或准备故障影响时，立即停跑。保留已发布记录，修好后按授权只补受影响格。可恢复的单次 5xx 先核对重试结果和同端点的其它在跑格。11 月 16 日 Install 首轮 11/15 errored，降至 3 格并发的补跑仍遇 530。11 月 21 日另有 Agent Judge 被账号并发限制拒绝。 [11 月 16 日验证](validation-2026-11-16.md#补跑网关源站间歇不可用同日) · [11 月 21 日验证](validation-2026-11-21.md)

## 公开 CLI 呈现缺口

- 已读的 `usage` 切片给出 Judge 传输类型、模型与费用缺口。历史网关 URL、账单账号、Provider 实付和可用于核账的请求关联缺失。Codex 上报量也缺少可按实际端点归集的物理调用标识。
- `application / usage-not-recorded` 缺实际内层调用数和费用。模拟用户只给出已记录调用数和缺价状态。公开 CLI 无法用这些字段回填内层模型、Judge 或模拟用户的实际账单。
- `timing` 给的是阶段耗时，Invocation 给批次墙钟。当前公开结果缺少逐实例的计费窗口、回收后计费时长和费率。
- 随包 CLI 文档给出 `--reprice` 命令形状，未提供本批网关价目或 JSON 结构范例。
