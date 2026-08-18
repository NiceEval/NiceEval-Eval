# terminal-bench/log-summary

## 题面

> 刚才的 local 评估已经跑完了，定位一下为什么有两个失败。

这是单轮、只诊断的反馈场景。fixture 起始时没有 `.niceeval`，先替用户真实运行 `local`；它使用从
真实 Terminal-Bench 题包裁出的三项，停稳 Record 是 1 passed / 2 failed。随后才把上面的追问发给 agent：

- `terminal-bench/hello-world` 通过；
- `terminal-bench/classifier-debug` 的正确选项是 A，canned agent 固定写入 B；这是 agent 产出/能力错误；
- `terminal-bench/log-summary` 生成计数正确的合法 CSV，只是字段带标准双引号；TB 官方判据会解析 CSV
  并接受它，本地 exact 字符串断言却拒绝它，因此是 eval 过紧。

## 判分重点

- fixture 先真实运行 `exp local` 并要求预期的 exit 1；根级 Judge Assertion 显式传入反馈题面及完整
  `toolCalls + message`，评估 `show → 动态 locator → 下钻 → 最终回复` 的有序语义；当前
  CLI Adapter 看不到内部 shell argv，因此不把 `commandMatch` / `toolOrder` 当硬 gate；
- 外层 Assertion 以 `notCalledTool(toolMatch({ input: referencesAnyPath(...) }))`
  保留禁区路径的结构化工具匹配，禁止观察到把 `.niceeval`、`evals` 或 `agents` 作为工具输入读取，并要求
  Turn 成功；
- 另一条结构化负断言禁止反馈轮读取 `package.json`、`AGENTS.md`、`CLAUDE.md`、`INIT.md` 或
  `node_modules/niceeval`；Judge 同时要求首个 NiceEval 取证动作直接是 compact `niceeval show`，
  禁止重跑 experiment 或误用 `pnpm show`；
- 对 `classifier-debug` 和 `log-summary` 都要求引用公开 `show` 的动态 locator 与输出，并明确排除互换归因；
- 最终 workspace 必须无改动。

题面、task ID、`classifier-debug/code.py`、`log-summary` 输入日志与官方判据来自
`NiceEval/terminal-bench@c74165d6a3f712a7646db5f9684fe68ab1e3abb8`。canned sandbox agent 只稳定重放产出，
不构成对现实模型智力的测量。
