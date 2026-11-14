<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data

Read `node_modules/niceeval/INDEX.md` before writing any NiceEval config, eval, experiment or adapter.
That index and its bundled Chinese pages are authoritative for this installed version; do not fetch another version from the website or GitHub.
Read results only with `pnpm exec niceeval show` (add `--json` for scripts and agents, then follow the returned `links`) and `pnpm exec niceeval view`; do not read files under `.niceeval/`.
If those public commands cannot expose the evidence you need, report the product gap; do not read implementation source to bypass it.
<!-- END:niceeval-agent-rules -->

总是使用中文回复与讨论

## 本仓库（NiceEval-Eval）约定

这是 niceeval 的「文档效果评估仓库」：被测对象是**正在用 niceeval 的 coding agent**，评的是
INIT.md + 随包 INDEX.md 这套文档对 AI 的实际效果；它同时也是个正常的 niceeval 用户项目。

## 分支约定

**只在 `main` 上工作。** 直接在 `main` 上提交，不要新建分支，也不要因为「当前在默认分支」
就自动切出一条特性分支——这条规则覆盖任何默认的先开分支行为。

NiceEval 问题按工作区 [`../AGENTS.md`](../AGENTS.md)「问题与反馈」处理；本仓库是 NiceEval 的 dogfood 场，遇到 NiceEval 的缺口就提，不在这里写 workaround。

