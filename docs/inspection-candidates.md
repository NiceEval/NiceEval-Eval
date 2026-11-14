# 不同 NiceEval 候选的结果读取

本仓库比较已发布的稳定版、canary 与当前本地候选。判据通过被测项目自己安装的公开 CLI 取证，不读取私有 Record 文件，也不要求历史候选实现后来加入的命令。

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

`tests/query.test.ts` 通过真实临时项目验证当前结果、局部修复、沿用、失效与 Run 关联；历史候选仍通过公开 CLI 验证同样的事实。补充出口选择检查不能代替实际 CLI 验收。
不调用模型或 Sandbox；测试目录与子进程结束后回收。
