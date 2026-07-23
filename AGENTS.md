<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data

Its APIs and conventions may differ from anything you have seen. Start with
`node_modules/niceeval/INDEX.md`, then read the task-specific bundled guides it points
to before writing any eval, experiment, adapter, or niceeval config. That index and
the bundled Chinese docs are the authoritative version matching this installation.
After a run, drill into failures with `niceeval show` — pick an `@<locator>` from the
compact index it prints, then `niceeval show @<locator>` for a compact overview, or add
`--source` / `--execution` / `--diff` for evidence; the snapshot directories the CLI prints
are the structured source of truth: `snapshot.json` holds the run's metadata and each
`<evalId>/a<attempt>/result.json` holds that attempt's verdict and assertions, next to
its artifact files (`events.json` / `trace.json` / `diff.json`).
<!-- END:niceeval-agent-rules -->

总是使用中文回复与讨论

## 本仓库（NiceEval-Eval）约定

这是 niceeval 的「文档效果评估仓库」：被测对象是**正在用 niceeval 的 coding agent**，评的是
INIT.md + 随包 INDEX.md 这套文档对 AI 的实际效果；它同时也是个正常的 niceeval 用户项目。

## 分支约定

**只在 `main` 上工作。** 直接在 `main` 上提交，不要新建分支，也不要因为「当前在默认分支」
就自动切出一条特性分支——这条规则覆盖任何默认的先开分支行为。


