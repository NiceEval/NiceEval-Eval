<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data

Its APIs and conventions may differ from anything you have seen. Start with
`node_modules/niceeval/INDEX.md`, then read the task-specific bundled guides it points
to before writing any eval, experiment, adapter, or niceeval config. That index and
the bundled Chinese docs are the authoritative version matching this installation.
After a run, use this repository's package-manager invocation of `niceeval query` for
machine-readable inspection (`pnpm --silent exec niceeval query discover` in a pnpm
project), then run a fixed request from that discovery document. Use
`niceeval view --run <run-id>` for human inspection in the browser, or
`niceeval show @<locator>` for an Attempt's details in the terminal.
When diagnosing an existing run, do not inspect raw `.niceeval` files or treat the current
`evals/` or `agents/` source as evidence of what happened in that run. If `niceeval query`
cannot expose the evidence you need, report that product gap. Reading source remains
appropriate when the task is to author or modify that source.
<!-- END:niceeval-agent-rules -->

总是使用中文回复与讨论

## 本仓库（NiceEval-Eval）约定

这是 niceeval 的「文档效果评估仓库」：被测对象是**正在用 niceeval 的 coding agent**，评的是
INIT.md + 随包 INDEX.md 这套文档对 AI 的实际效果；它同时也是个正常的 niceeval 用户项目。

## 分支约定

**只在 `main` 上工作。** 直接在 `main` 上提交，不要新建分支，也不要因为「当前在默认分支」
就自动切出一条特性分支——这条规则覆盖任何默认的先开分支行为。

NiceEval 问题按[工作区问题上报规则](../AGENTS.md#niceeval-问题上报)，直接在 [NiceEval Issues](https://github.com/NiceEval/NiceEval/issues) 查重后创建 issue。

