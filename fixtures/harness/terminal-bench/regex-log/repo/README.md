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
请以 NiceEval 的公开运行和诊断界面判断当前结果，并保留每个结果原本的
`passed` / `failed` / `errored` 语义。
