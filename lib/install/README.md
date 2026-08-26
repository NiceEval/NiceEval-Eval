# install Eval 结构

正式 install 题分别位于 `evals/install/db-gpt/eval.ts` 与
`evals/install/gpt-researcher/eval.ts`。每道题自己的宿主 fixture、题目事实、交互续轮、评分和
产物归档都收在所属目录内，不再 import 本项目的 install helper。两份评分流程有意各自持有：
修改一题的事实或判据不会改变另一题的源码指纹，单独打开一份文件也能看清完整被测流程。
候选版本的物化、INIT.md 地址和随包页面校验仍统一复用 `lib/candidate.ts`，它们属于实验控制面，
不复制进各题。

`lib/install/` 只保留 roadmap 题复用的辅助实现，不是正式 install 题的评分入口。

## 正式题流程

1. 准备宿主 fixture，要求 Agent 按指定版本的 `INIT.md` 安装并阅读随包文档。
2. 首轮检查 Agent 是否在写接入代码前确认接口、观测、实验变量、Tier 和核心业务边界。
3. 用不泄露 rubric 的最小用户答复继续任务。
4. 依次检查安装基础、真实 experiment、同一公开 locator 的 `show` 证据和源码质量。
5. 在 `finally` 中归档 agent 输出，失败样本也可复审。

全题是 52 分的纯计分制，不使用通过制 Verdict：

| 阶段 | 分值 | 结构性截断 |
| --- | ---: | --- |
| 首轮交互 | 8 | 无 |
| 完成交接 | 4 | 无 |
| 安装与 dry plan | 12 | `orStop` |
| 已发布 attempt | 15 | `orStop` |
| 源码与实践 | 13 | stand-in 命中后不再发放 |

`orStop` 只停止后续计分，已得到的分数保留。正式题直接调用候选版本的本地
`./node_modules/.bin/niceeval`，不从对话文本猜命令，也不通过 `npx` 绕过候选版本。
overview、verdict、execution 和 source 必须绑定同一个公开 locator；如果执行证据明确显示 Agent 用
stub / mock 代替被测服务，则分数封顶在该屏障之前。

## 共享辅助

roadmap 题仍可使用这些模块：

- `interaction.ts`：路线澄清与不泄露 rubric 的续轮。
- `installation.ts`：安装、discovery 和 dry plan 检查。
- `adapter.ts` / `experiment.ts` / `authoring.ts` / `sandbox.ts`：各阶段检查。
- `quality.ts` / `documentation.ts`：设计和文档路由评分。
- `fixture.ts` / `archive.ts`：fixture 精确 commit checkout、源码取证和 attempt 归档。

roadmap 的题目事实仍放在 `fixtures/roadmap/<case>/case.ts`。
