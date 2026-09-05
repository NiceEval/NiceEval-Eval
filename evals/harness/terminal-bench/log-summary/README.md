# terminal-bench/log-summary

## 题面

> 刚才的 local 评估已经跑完了，定位一下为什么有两个失败。只分析已有结果，不修改项目、不重新运行评估。

这是单轮、只诊断的反馈场景。fixture 起始时没有 `.niceeval`，先替用户真实运行 `local`；它使用从
真实 Terminal-Bench 题包裁出的三项，停稳 Record 是 1 passed / 2 failed。随后才把上面的追问发给 agent：

- `terminal-bench/hello-world` 通过；
- `terminal-bench/classifier-debug` 的正确选项是 A，canned agent 固定写入 B；这是 agent 产出/能力错误；
- `terminal-bench/log-summary` 生成计数正确的合法 CSV，只是字段带标准双引号；TB 官方判据会解析 CSV
  并接受它，本地 exact 字符串断言却拒绝它，因此是 eval 过紧。

## 判分重点

- Fixture 用公开 query 核验真实初始结果，再交给 agent。每个失败分别评公开证据 2 分、任务事实 2 分、责任归因 3 分，共 14 分。
- 允许先读 INDEX、指南和项目源码；运行事实必须由公开 show 或 query 证明，不要求固定命令拼写或第一步就是 show。
- `.niceeval` 是唯一禁止直接读取的结果路径。负向工具匹配不等于完整 OS 文件访问审计。
- `no-changes` 检查项目文件保持不变，`no-new-runs` 检查没有新发布 Run；与解释质量分开报告。
- 两个 failed 必须区分责任：classifier 是 agent 选错，log-summary 是本地断言拒绝合法 CSV。说明 NiceEval runtime 正常不应被误判为否认 Eval 过紧。

题面、task ID、`classifier-debug/code.py`、`log-summary` 输入日志与官方判据来自
`NiceEval/terminal-bench@c74165d6a3f712a7646db5f9684fe68ab1e3abb8`。canned sandbox agent 只稳定重放产出，
不构成对现实模型智力的测量。

Rubric v2 接受公开 show/query 的等价证据，外层公开 JSON 核验起始状态与前后 Run 集合。14 分解释质量与 no-changes / no-new-runs 边界分开报告，详见 [套件说明](../../README.md)。
