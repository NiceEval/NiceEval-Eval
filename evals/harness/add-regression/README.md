# 补回归并修业务

## 题面

真实工单来自一个“当前 suite 全绿、线上行为却错了”的覆盖缺口。第一轮要求 agent 新增一条
回归 eval 并实际跑出红色，但暂时不能修业务；第二轮才授权修实现、保留回归并全量复验。

起始项目有五道绿色 policy eval，但没有覆盖“订单进入履约或已经出库后不能取消”。业务实现
错误地回答“交付前随时可取消”，因此一条有效的新回归应把结果变为
`5 passed / 1 failed / 0 errored`；正确修复后的全量结果是 `6 / 0 / 0`。

## 判分深度

- `calledTool` 分别确认调过 `niceeval exp local` 与 `niceeval show`，目标 `eventOrder` matcher
  表达运行、下钻、最终回复的顺序；
- workflow、execution、response 三个 LLM judge 分别判断真实调用语义、CLI 输出和回复结论，
  不解析 NiceEval CLI 或 record；
- 第一轮机械要求恰好新增一条会被 `local` 选中的 eval，且业务实现暂时不变；
- 另一个 judge 直接审新 eval 的语义，排除恒真、skip 或弱断言；
- 第二轮要求新 eval 原样保留，并验证业务实现确实发生变化；
- agent 离场后才执行隐藏 black-box 行为测试，覆盖履约前、履约中与已出库三种提问；
- 0.12+ 必须处理业务源码不进 fingerprint 的 carry 语义并做 fresh full rerun；0.9.x 按其自身
  CLI 契约重新完整运行，不要求不存在的 flag。

项目来自本题自己的 `fixtures/harness/add-regression/repo/`，不携带 `.niceeval`。
