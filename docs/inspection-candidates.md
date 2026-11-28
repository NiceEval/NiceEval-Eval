# 不同 NiceEval 候选的结果读取

本仓库比较已发布的稳定版、canary 与当前本地候选。判据通过被测项目自己安装的公开 CLI 取证，不读取私有 Record 文件，也不要求历史候选实现后来加入的命令。

## 固定一批 canary 的候选版本

开始新批次时，清除上批的 `NICEEVAL_CANDIDATE_VERSION`，再做一次 dry。canary 入口从 npm 已发布版本中按 semver 取最大值（包含预发布版），在 stderr 打印一行 `NICEEVAL_CANDIDATE_VERSION=<版本>`。同一次调用中的两个 canary 入口共用该版本。

```sh
export NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"
unset NICEEVAL_CANDIDATE_VERSION
pnpm --silent exec niceeval exp harness/canary --dry --json
```

把 stderr 中的赋值加上 `export` 执行。以下命令以 `0.22.2-canary.135` 为例。

```sh
export NICEEVAL_CANDIDATE_VERSION=0.22.2-canary.135
pnpm --silent exec niceeval exp harness/canary --dry --json
pnpm --silent exec niceeval exp install/canary --dry --json
```

在初筛、正式批次和定向补跑中沿用同一个 `NICEEVAL_CANDIDATE_VERSION`。新终端或跨日补跑时，从批次记录恢复该值，再按原实验入口与本次所需题目范围做 dry。变量只作用于 `harness/canary` 和 `install/canary`，值必须是已发布的精确版本号。版本范围和 `latest` 等 dist-tag 会被拒绝。

每批记录以下信息。

- 实际被测的候选精确版本。
- NiceEval-Eval 的 commit，可用 `git rev-parse HEAD` 取得。
- 每条命令选择的实验、题目范围和 `--dry --json` 的 `total`、`reused` 及逐格原因分布。用 `.matrix[].slots[]` 的 `reason` 统计缺口，沿用格以 `state` 为准。
- 正式运行和各次补跑的 Run ID，可从 `exp --json` 的终态 receipt 取得。

## 固定读取

`lib/query.ts` 是这些候选之间的进程传输适配，不定义评分语义。调用方继续请求以下固定操作，返回候选的公开 document，判据按已有字段读取：

| 操作 | 当前 CLI |
| --- | --- |
| `project.get` | `niceeval show --json` |
| `experiment.get` | `niceeval show exp:<id> --json` |
| `run.list` | `niceeval show runs --json` |
| `run.get` | `niceeval show run:<id> --json` |

用公开 `--help` 确认候选是否提供 `query`。历史候选提供时，使用它自己的 `query discover` 返回的 v2 / v3 请求形状；没有该命令的当前候选使用上表的对象地址。每个 Shell 缓存一次能力发现，不按版本号猜能力。
已选出口报错后不自动切换另一个出口。未知操作、非 JSON、operation 不匹配或证据 issues 均明确失败；只有 `inspection-selection-missing` 返回 null。
所有用户值按 shell 参数正确引用，不用拼接 JSON 构造可执行命令。

当前 verdict、Attempt identity 与 locator 保留既有 v2 / v3 字段位置投影；不将未知事实补零、不把未发布当成成功。`exp --json` 从终态 receipt 取得实际 Run ID。

## 文档与验收

评审提示要求按被测版本的随包 INDEX 和公开帮助选择等价查看入口。Run、Attempt、execution 和 source 都要能定位到实际结果；不因版本使用旧参数或对象地址而扣分。
本仓库 README 的日常命令使用当前本地安装的对象地址。初始化托管区由 `niceeval init` 更新，不手改生成区。

各候选通过公开 CLI 读取当前结果、局部修复、沿用、失效与 Run 关联；`lib/query.ts` 不另写单元测试，由 Harness 题的真实运行验收。
