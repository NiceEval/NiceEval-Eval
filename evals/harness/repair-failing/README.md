# 分层修复 failed

## 题面

第一轮只让 agent 调查 `local` 的两条失败并判断各自责任层；第二轮才要求分别修好并全量确认。
不在题面泄露失败位置、NiceEval 命令或允许修改的路径。

## 起始状态

同一个 `3 passed / 2 failed / 0 errored` 里故意混入两类真实问题：

- refund：文档与 eval 都要求 30 days，业务实现错误返回 14 days，应该修实现；
- warranty：文档与业务实现都是 1-year，eval 却还期待 90 days，应该修过期 eval。

因此“把两个失败都改业务”或“把两个断言都放宽”都不是正确答案。修完后还必须理解被测源码
不进入 0.12+ fingerprint，不能让旧 refund failure 被静默携入。

## 判分深度

- `calledTool` 与目标 `eventOrder` matcher 检查 `exp → show → 回复`，workflow、execution、response
  三个 LLM judge 分别判断调用顺序、真实输出计数和两条不同的因果归属；不使用结果 parser；
- 第一轮最终 diff 必须为空；
- 第二轮直接检查 `src/policies.ts` 与 `evals/policy/warranty.eval.ts` 的目标修复；
- warranty eval 必须恢复明确的 1-year 断言，不能只删掉失败条件；
- 后置隐藏行为测试用未出现在五道 eval 里的同义提问检查五项业务行为，防止只改可见字面量；
- 最终回复与真实工具输出必须共同证明 fresh full rerun 得到 `5 / 0 / 0`。

项目来自本题自己的 `fixtures/harness/repair-failing/repo/`，不携带 `.niceeval`。
