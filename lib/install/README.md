# install Eval 共享机制

`evals/install/<case>/eval.ts` 与 `evals/roadmap/<case>/eval.ts` 只编排场景：校验候选、准备宿主、发送任务、按顺序调用检查阶段、归档。

| 模块 | 职责 |
| --- | --- |
| `installation.ts` | 安装落点、过程侧与安装最佳实践评分 |
| `interaction.ts` | 首轮澄清、HITL 续轮与完成交接 |
| `adapter.ts` / `experiment.ts` / `authoring.ts` / `sandbox.ts` | 各自独立的检查阶段 |
| `quality.ts` / `documentation.ts` | 产出设计与文档路由的计分阶段 |
| `criteria/` | 可跨题复用的 rubric 机制；不含宿主事实 |
| `fixture.ts` / `archive.ts` | fixture clone、源码取证和 attempt 产物归档 |

题目特有的 repo、版本、协议、质量事实与文档落点在 `fixtures/install/<case>/case.ts`；只有该题独有的长 rubric 才放同目录 `rubrics.ts`。

## install 正式题的计分顺序

`evals/install/` 使用 `outcome-weighted` 模式，仍然是纯计分制，不引入通过制 Verdict：

1. 完成交互后，安装落点、精确候选版本、Eval discovery、dry plan、真实 `exp`、公开 `show`、
   terminal result 与 `ASSISTANT` 执行证据依次形成 `orStop` barrier。
2. barrier 失败时保留此前已得的部分分，但不再发放 experiment / adapter / authoring / 设计品味分。
3. 关键结果按 3–8 分加权；文档路由与源码姿势仍各 1 分。无 `tsconfig` 时满分 93，存在且
   typecheck 干净时额外得 1 分，不能再用大量软分掩盖未跑通。
4. `orStop` 后仍在 `finally` 中归档 agent 产物，保证失败样本可人工复审。

`evals/roadmap/` 没有显式选择该模式，继续使用原来的 additive 评分，避免未来题的预览语义被正式题改动连带改变。
