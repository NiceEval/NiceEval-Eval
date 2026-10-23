# 2026-10-23 全范围真实验收

本次检查 `harness/v0.19.0`、`harness/canary`、`install/v0.19.0`、`install/canary`，目标候选分别为 npm `0.19.0` 与 `0.19.1-canary.101`。遵循 fix-forward：保留已通过结果，只补跑受影响的题；因此这是一组混合运行批次，不用于稳定性或版本优劣的统计推断。

外层观察运行时使用本地修复候选，SHA-256 为 `21ebcc8e00897576056fe2a723fa08499fe01b2a15684c00826a95a8344f5d38`。该依赖通过本机 tarball override 安装，脱离相邻工作区共享 dist；本机 override 与锁文件未提交。被测 agent 安装的目标候选版本没有随之改变。

## Harness

两版本各 4/4 passed、50/52 分。最后 `exp --dry --json` 确认 8/8 沿用。

| 用例 | 0.19.0 | canary |
| --- | --- | --- |
| cancel-async-authoring | 16/18 · `@10TJYK6CGTYMA` | 18/18 · `@14RR50R86WJZS` |
| log-summary | 14/14 · `@1809DN36Q7KCV` | 12/14 · `@19NMDTBRMSQXS` |
| regex-log | 10/10 · `@1HF7H0WME46S0` | 10/10 · `@1ARY5DRS0MG8Q` |
| regex-log-authorized | 10/10 · `@1ZCNYMF472YQ3` | 10/10 · `@1N88HSMV9R0HN` |

稳定版前两项来自 Run `18bad6a4-1876-4ac1-b3cf-297c14f23264`，后两项补验来自 `87888571-b2b3-4832-8608-375b9e5656f8`。canary 四项来自 `f26fafae-9c7d-4593-ac4f-083f4ad01694`。原中断批次保留，不改写其状态。

## DB-GPT

两个版本均完成实际数据问答与缺字段负例，但原外层评分错误地只向真实来源 Judge 提供 `show --source`：其中有 Eval 与 Effect 源码，却没有 Adapter。原 Attempt 的失败评分保持不变：稳定版 `@1072C8D5D9BTZ` 为 52/86，canary `@1DQEJWQR2H70N` 为 47/86。

公开执行证据中，稳定版给出 North=205、South=235、West=70、合计 510、5 行及缺失 `customer_email` 的解释；canary 给出 6435 条、45 家门店、后续问答及缺字段拒答。没有为修评分再次运行 coding agent 或 DB-GPT。

使用公开断言材料补齐作者源码后，只回放真实响应门槛：canary `@142CT7GCK114Z`、稳定版 `@1VK9P3YSW2GGF` 均通过。这不是原 Attempt 的完整重新评分。回放 Run 分别是 `d0aa6879-cc8f-4d57-884a-494743db7e65` 和 `3f3020f6-9696-44fc-b8d7-280bcaa9b6c4`，位于独立临时验证项目。

## GPT Researcher

DuckDuckGo 补跑已完成：两个版本均有真实报告，真实响应 gate 均为 matched。canary 的 `web-research/facts`（`@151H52QQM5YPG`）和 `web-research/missing-evidence`（`@1YM78Y1MDTY5M`）均 passed，来自内层 Run `83dbcde1-6ff7-43b2-8af3-0b80aa8c08d0`，13 条断言匹配。稳定版 `web-history`（`@1N3B8A27E9XA4`）passed，来自 `51e20240-2945-4085-8122-51d27f28d97f`；`missing-source`（`@1KZK46NM0ERBT`）因没有取得来源而 failed，来自 `57e7154e-cd73-4ba4-9266-092997f4e37f`。后者没有被较早的成功结果掩盖。

canary 报告涵盖 2024 诺贝尔物理学奖及原始来源；稳定版报告区分 CERN 的 1989 年 Web 提案和 1993 年软件公开发布，并有来源引用。两者均自主处理了 embeddings 接口缺失；这不是人工插入修复提示后的重跑。

外层 Run `a5fcf6f4-2ba0-4fb9-9700-92e0786de094`（canary `@1CAKJ10309G3Q`）和 `b887f576-0209-4d52-a117-4af3fc5522ce`（稳定版 `@1W0XJGF681HH5`）仍正式记为 errored：末尾评分登记触发 `Attempt Assertion retention cannot exceed 64 MiB`。原始记录不改写，不能把这些外层结果称为全绿。

预算问题已在本仓修复：每项 Judge 的 2 MiB 审计预留改为 1 MiB，保留 512 KiB 材料上限及不可判定语义。34 项小材料在旧设置下复现相同错误；1 MiB 下，34 项、每项 300 KiB 的公开 CLI 验证完整结算 34/34。永久回归测试还覆盖 34 项、每项 72 KiB 中文材料。外部裁判使用本地 HTTP fixture；这是评分登记与留存的验证，不代表模型质量，也没有再次执行整轮 coding agent 或目标应用。

旧批次稳定版 `@1CVZM1X5FFY41` 为 39/86，canary `@1ZA2512YJ4QVE` 为 42/86，均没有完成含来源与引用的正向报告。用户选择内置 DuckDuckGo 后修正运行回答，同时修复目标代理把已解压响应体与 `content-encoding` 一起转发、导致客户端二次解压的问题。

中间两次准备失败保留：默认 18080 被本机其它开发服务占用；改 18081 虽可绑定，但 Incus VM 无法访问。两批都没有开始模型执行。用户自行释放 18080 后才恢复补跑，未停止或修改其它任务的服务。

## 修复与验证

- 本仓 `bbb5a19` 取消内层格数、Attempt 数、运行轮次限制与代理累计请求/独立倒计时限制；保留取消、teardown、凭证隔离及传输保护。
- 本仓 `a97df6d` 修正作者源码与执行证据的组合，允许预期负例的合法拒答，明确 DuckDuckGo 搜索选择，并修复代理重复解压。
- `pnpm run typecheck` 通过；`pnpm test` 4/4 通过（含评分留存回归）。真实压缩 HTTP 响应经实际代理，修复前 JSON 解码失败、修复后成功。
- 上游修复提交 `41d0c6b0a` 已推送；146 项 Unit、类型检查、50 项文档检查及站点校验通过。断言详情修复将来源行文本策略与持久化断言的 8192 字节限制分离。正式红灯 `nered_YN7Y5HV9R4BMBT6S`；正式验收 `netake_4WCGEHNG7403T66N`：七次观察通过，默认并行 37/37，资源清理成功。真实下游 `@19NMDTBRMSQXS` 的原失败断言详情也恢复可读。

## 成本与限制

从本次 10:30 UTC 开始的 13 个已完成或中断 Run 中，公开查询去重得到 21 个已发布原始 Attempt，包含被后续结果替换的失败与环境错误。已知裁判调用 244 次，输入 1,364,795 token、输出 33,677 token；另外三次独立证据回放共 3 次裁判调用，输入 29,733 token、输出 648 token。金额全部 unavailable。这些计数不代表 coding agent、内层研究调用和目标应用的完整用量。没有调用付费模型的本地裁判 fixture 测试单独验证基础设施，不计入上述模型调用。

最终 `niceeval sandbox provider doctor incus --development` 为 PASS、4/4 执行槽位空闲；目标代理 18080 已关闭。正式 E2E 的进程与临时工作目录回收成功。本轮残留 pane/tab/worktree：无。

仍需跟进的上游 DX 缺口以本地草稿保存：Incus 准备进度不可见、takeover 失败缺少具体诊断、随包文档未说明 Judge 审计累计预算。未发布远端 Issue。

费用缺失保持未知；目标应用代理没有完整的逐调用计费记录。不能用最终成功一轮、当前实验页面的费用、CLI 简短 token 汇总或零值代表全部历史账单。所有结果通过公开 `niceeval query` / `show` 读取，没有读取或改写 `.niceeval` 私有记录。

源码取证仍沿用既有标准目录探针，不保证收集任意目录中的辅助实现；本次材料修正没有扩展为完整 import 闭包采集。
