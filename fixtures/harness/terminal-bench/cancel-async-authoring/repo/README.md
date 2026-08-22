# cancel-async-tasks · NiceEval authoring fixture

这里是一份尚未接入 NiceEval 的真实 Terminal-Bench 题包。目标文件为：

```text
evals/terminal-bench/cancel-async-tasks.eval.ts
```

来源是 `NiceEval/terminal-bench` 历史提交 `5964952` 中的 `cancel-async-tasks`。`task.yaml`、
`tests/`、`run-tests.sh` 与 `solution.sh` 保留官方内容；`fixture/Dockerfile` 把官方 Python
环境替换为 Harness 预载的离线 runtime，并维持相同的 `/app` 工作目录约定。

Harness 不能访问网络，所以提供 `run-tests-offline.sh`：它只省略官方 `run-tests.sh` 中安装
curl、uv 与 pytest 的步骤，实际调用的仍是未经修改的 `tests/test_outputs.py` 全部测试函数。

`tests/`、两个 runner 与 `solution.sh` 都不属于给 task agent 的起始材料。正式 Eval 应只用
`task/fixture/` 作为 Docker build context，在 `t.send()` 返回后再上传测试和离线 runner。

两格固定实验各只选择目标 Eval：

- `oracle` 在 agent turn 中写入官方参考实现，正确 Eval 应 passed；
- `leak-probe` 检查 agent turn 开始时是否看得到隐藏材料。无泄漏时它故意写入错误实现，正确
  Eval 应 ordinary failed；若隐藏材料提前出现，它会改写为参考实现，从而暴露泄漏。
