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

本任务允许修改 `experiments/local.ts` 中的运行配置；保留题面、Eval、判据和 canned agent。
允许在该配置中使用等价的运行环境，不要求采用某个固定镜像标签。项目内确定性评估的运行与
必要复验已获授权；不得修改判据或被测产出来消除合法业务失败。
