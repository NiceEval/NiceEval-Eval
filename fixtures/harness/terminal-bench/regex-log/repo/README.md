# terminal-bench/regex-log fixture

这是从 `NiceEval/terminal-bench` 的已审核题包裁出的独立 NiceEval 项目，源版本为
`c74165d6a3f712a7646db5f9684fe68ab1e3abb8`。它保留四个真实 Terminal-Bench task ID、题面和
相关初始资产：

- `hello-world`
- `fix-permissions`
- `classifier-debug`
- `regex-log`

为了让 Harness 在三个候选 NiceEval 版本中离线、确定性运行，这里不复制 TB 的联网 Docker
build，而是在预载的 node / python runtime 中由 canned sandbox agent 重放固定产出。
`regex-log.test.py` 是 TB 官方判据的逐字节副本；其余检查保留对应官方判据的关键事实。

初态固定为 2 passed / 1 failed / 1 errored：`classifier-debug` 的固定答案错误是合法 failed，
`regex-log` 的官方判据需要 Python，而初始 experiment runtime 没有 `python3`。
