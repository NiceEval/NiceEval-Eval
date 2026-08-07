# 修复 errored 实验

## 题面

第一轮只请 agent 调查 `local` experiment 为什么跑不起来；第二轮再让它修好并确认。
不告诉它这是 `errored`、根因在哪一层，也不提供 NiceEval 命令。

## 起始项目

本题自己的 `fixtures/harness/repair-errored/repo/` 直接携带不可达 backend endpoint。第一次
实际运行会让五道题全部形成 `errored`，而不是 assertion `failed`。项目文档记录了本地
backend 的正确配置；不依赖中央 fixture 或 evaluator 注入。

## 希望测试的内容

- 是否自行运行 experiment，取得真实错误和 locator；
- 是否用结果证据区分执行错误与断言失败；
- 是否找到配置层根因，而不是修改业务答案、eval 或断言；
- 是否在第二轮延续上下文，修改 `config/policy.json`；
- 是否局部重跑并确认最终通过。

两轮回复的诊断与复验内容直接交给各自 turn 的 LLM judge；evaluator 不解析 `show`、record
或命令文本。机械断言只负责“第一轮未改文件”、配置文件确实被修复及 endpoint 最终值。
