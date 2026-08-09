# terminal-bench/log-summary fixture

这是从 `NiceEval/terminal-bench` 的已审核题包裁出的独立 NiceEval 项目，源版本为
`c74165d6a3f712a7646db5f9684fe68ab1e3abb8`。它保留三个真实 Terminal-Bench task ID、题面和
相关初始资产：

- `hello-world`
- `classifier-debug`
- `log-summary`

为了让 Harness 离线、确定性地区分失败责任层，canned sandbox agent 对
`classifier-debug` 写入错误选项 `B`；对 `log-summary` 则写入语义正确、TB 官方 CSV 判据可以
接受的带引号内容。本项目中的 exact 字符串断言会错误拒绝后者。`log-summary.test.py` 是 TB
官方判据的逐字节副本，用于固定这项语义事实。
