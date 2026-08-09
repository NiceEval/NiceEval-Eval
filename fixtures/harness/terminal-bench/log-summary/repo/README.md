# terminal-bench/log-summary fixture

这是从 `NiceEval/terminal-bench` 的已审核题包裁出的独立 NiceEval 项目，源版本为
`c74165d6a3f712a7646db5f9684fe68ab1e3abb8`。它保留三个真实 Terminal-Bench task ID、题面和
相关初始资产：

- `hello-world`
- `classifier-debug`
- `log-summary`

为了让 Harness 能在离线环境中确定性运行，项目使用 canned sandbox agent
重放固定产出。`log-summary.test.py` 保留 Terminal-Bench 题包中的参考判据；请以
NiceEval 的公开运行和诊断界面判断当前结果。
