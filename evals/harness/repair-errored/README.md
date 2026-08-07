# 修复 errored 实验

## 题面

第一轮只请 agent 调查 `local` experiment 为什么跑不起来；第二轮再让它修好并确认。
不告诉它这是 `errored`、根因在哪一层，也不提供 NiceEval 命令。

## 起始项目

`repo/` 不携带 `.niceeval`。它包含一个确定性 policy agent，业务实现和断言都正确，但本地
backend endpoint 指向不可达地址。第一次实际运行会在 agent 执行阶段形成 `errored`，而不是
assertion `failed`。项目文档记录了本地 backend 的正确配置。

## 希望测试的内容

- 是否自行运行 experiment，取得真实错误和 locator；
- 是否用结果证据区分执行错误与断言失败；
- 是否找到配置层根因，而不是修改业务答案、eval 或断言；
- 是否在第二轮延续上下文，修改 `config/policy.json`；
- 是否局部重跑并确认最终通过。

隐藏判分会独立复跑、检查最终配置、diff 范围以及 agent 实际执行过的 NiceEval 命令。
