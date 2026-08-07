# Harness 评估套件

这组题评估 coding agent 能否在一个已经积累真实 NiceEval 结果的项目中，只通过公共 CLI
完成检索、比较、定位和证据下钻。它不评 NiceEval 核心能否读取 schema，也不让 agent 重跑实验。

## Folder-local 契约

每个 `evals/harness/<id>/` 都是独立题包：

```text
<id>/
├── eval.ts       # 题面、过程约束和判分
├── README.md     # 给维护者看的中文项目说明；不会上传给 agent
└── repo/         # agent 开始工作时拿到的完整项目与历史结果
```

题包不能从其它题包或中央 `fixtures/results/` 借起始数据。删掉任意一个兄弟目录后，剩下的题仍应能
独立发现、上传和运行。公共 `lib/harness-repo.ts` 只封装上传、安装 reader 和只读边界，不保存题目、
答案或 fixture 路径。

`repo/` 里的 TypeScript 文件在宿主机上使用 `*.ts.fixture` 后缀。这不是项目格式，而是传输护栏：
NiceEval 会递归发现外层 `evals/` 下的 `eval.ts` / `*.eval.ts`，TypeScript 也会递归检查 `.ts`；若把
内层项目源码原名放在这里，它会被当成宿主评估。`prepareHarnessRepo()` 在 `t.send()` 前恢复原名，
所以 agent 实际看到的是完整、可由 `niceeval show` 识别的起始仓库，恢复动作也不进入 agent diff。

## 为什么选择这 8 题

| 用例 | 层级 | 主要能力 |
| --- | --- | --- |
| `stale-experiments` | overview | 读懂过期/覆盖警告，并给出精确重跑入口 |
| `best-tradeoff` | compare | 在覆盖率陷阱存在时比较通过率与成本 |
| `failed-assertion` | locate | 从 eval + experiment 收窄到失败断言和 locator |
| `agent-actual-approach` | execution | 用 `--execution` 区分实际方案与机械重试 |
| `errored-vs-failed` | status | 区分基础设施 errored 与断言 failed |
| `ttft-partial-coverage` | observability | 正确说明指标只有部分 experiment 有证据 |
| `nonexistent-metric` | boundary | 数据没采集时拒绝编造资源指标 |
| `nonexistent-experiment` | boundary | 命名看似合理但实体不存在时拒绝补全 |

这 8 题形成一条从首屏到单 attempt 执行记录的下钻链，并用两道“数据不存在”题约束幻觉。每题都要求：

1. 至少使用一次 `niceeval show`；
2. 不直接读取 `.niceeval/**/*.json`；
3. 不运行 `niceeval exp`；
4. 不修改起始仓库；
5. 文档实验组继续测 `niceeval init` 托管指针是否把 agent 路由到随包文档。

## 数据身份与运行成本

每个 `repo/` 都独立携带同一个真实项目切片：NiceEval 0.4.6 写出的 schema 8 历史记录，最后由
NiceEval 0.9.1 reader 验证。选择同一快照是为了让题间事实一致；复制到每题则是为了让资产边界、
fingerprint 和维护责任都落在题内。

两格 experiment（有 / 无 agent rules）各运行 8 题，共 16 个付费 coding-agent attempt。
日常验证只运行 `pnpm run typecheck`、`niceeval list` 和 `niceeval exp harness --dry`；没有用户明确批准时，
不要启动整套真实实验。
