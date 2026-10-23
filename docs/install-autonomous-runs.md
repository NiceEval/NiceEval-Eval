# 安装题自主运行

安装题允许被测 coding agent 自主选择格数、Attempt 数及运行轮次，诊断和修复后无需再次申请运行授权。外层每个候选采样一次的设置保持原义；它不是内层运行预算。首轮仍检验 agent 是否询问未知的运行边界，回答明确给出自主运行授权。

`exp --dry --json` 只要求命令成功并包含非空 matrix，不再要求单格单次。真实运行证据由公开 `run.list` 确认存在，再从 `project.get` 的 `project.cells[].members[].publication` 读取每个格的当前结果；局部补跑不丢弃其它格，较早成功也不能掩盖后来的失败。所有当前 member 必须发布 Attempt，取其 locator 读取 overview、execution、source。每项判据仍只计一次分，Judge 同时审阅所有当前结果，完成状态与弱 passed 分要求所有当前结果满足对应判据。

不删除历史 Run 或较早失败的 Attempt。成本比较应保留全部运行的可取得用量，不能仅用最终成功结果代表总成本；缺失费用保持未知。目标应用代理目前只转发请求，不自行估算或声称已完整记录目标应用费用。

`show --source` 的可读性仍单独检查，但它不保证包含 Adapter。真实响应与来源解释的 Judge 材料使用交接时读取的作者源码，加上所有当前 Attempt 的 overview/execution，避免只给 Eval 与依赖源码而丢失响应映射。真实响应门槛要求至少一个正向核心用例；预期负例可以拒答或返回合法错误。全部结果仍须由源码解释，任何替代真实目标服务的实现都使门槛失败。GPT Researcher 的搜索选择明确为内置 DuckDuckGo，不要求额外 Tavily key。

代理删除累计请求上限及独立的 40 分钟会话定时器，沿用 Attempt 的取消与 teardown 回收 token、请求和 listener。固定模型、固定接口、凭证隔离、并发限制、请求大小与单次 upstream 超时保护保留。外层 Eval 的执行超时仍负责异常任务的终止。

验证：仓库 typecheck、现有 query 契约测试覆盖失败后局部修复和历史保留；真实安装题分别检查稳定版与 canary 的结果及取证入口。不以静态检查代替实际接入验收。
