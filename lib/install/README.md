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
