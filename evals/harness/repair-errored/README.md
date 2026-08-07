# 修复局部 errored

## 题面

第一轮只让 agent 调查为什么 `local` 里只有一部分 case 跑不起来；第二轮才授权只修运行时配置
并全量确认。不告诉它这是 `errored`，也不提供故障文件或 NiceEval 命令。

## 起始状态

普通 policy backend 已经可用，所以 exchange、shipping、privacy 三道通过；refund 与 warranty
还要经过共享 compliance 服务，而 `config/policy.json` 把它指向不可达地址。第一次真实运行稳定
得到 `3 passed / 0 failed / 2 errored`。这比“五道一起报同一个错”更能检验 blast radius 与
failed/errored 分类。

## 判分深度

- LLM judge 同时读取回复与宿主侧真实 shell 命令，验证实际运行、attempt 下钻、计数、受影响
  case、ECONNREFUSED 证据和共享配置根因；不使用命令正则或结果 parser；
- 第一轮最终 diff 必须为空；
- 第二轮只允许 `config/policy.json` 变化，其余 agent、业务实现、文档、eval 与 experiment
  逐字节保持不变；
- 配置最终必须精确恢复 `memory://policy` 与 `memory://compliance` 两个端点；
- 0.12+ 不能只自动重试两个 errored、携入三个 passed，必须实际做一次 full rerun；
- 最终回复与真实命令证据共同确认 `5 / 0 / 0`。

项目来自本题自己的 `fixtures/harness/repair-errored/repo/`，不携带 `.niceeval`。
