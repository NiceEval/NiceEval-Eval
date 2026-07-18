# debug fixture：签入的真实结果数据

debug eval 的考场是**一个已经跑出过结果的用户项目切片**：最小宿主配置（`niceeval.config.ts`、
experiment 与 eval 声明）加上**整目录签入的 `.niceeval` 结果数据**。

结果数据从真实评估项目导出，**不手造样例**——真实数据自带的复杂度正是被评对象。手造的
数据永远只包含出题人已经想到的情况，而 CLI 视图真正会露怯的地方恰恰是没想到的那些。

## 当前状态

`coding-agent-memory/` 目前只有题库骨架（`questions.yaml`），**还没有 `.niceeval` 数据**。
在真实导出放进来之前，`niceeval exp debug` 会因为标准答案对不上而整片失败——这是预期行为，
不是 bug。

放数据的步骤：

```sh
# 从一个真实评估项目导出并裁剪（见下方裁剪规则）
pnpm run export:debug-fixture -- <真实项目路径> coding-agent-memory

# 导出后人工核对题库：把 questions.yaml 里所有 TODO- 换成从数据里核对到的真实答案
```

## 一份合格的 fixture 要有什么

这些特征既是数据的验收标准，也是出题的素材面——缺哪一项，对应那一层的题就出不出来：

| 特征 | 支撑的题面 |
|---|---|
| 多 experiment group | 组间隔离与「先选对 scope」 |
| 视图由多快照组成、含 stale-verdict 警告 | 警告语义与重跑建议 |
| failed 与 errored 并存 | 断言失败与 sandbox / 运行错误是两类不同诊断 |
| 成本、时长、通过率跨度大 | 横向对比题的区分度 |
| attempt execution 有实质内容（thinking、工具调用、失败线索在 transcript 里） | 深挖题的答案落点 |

## 裁剪规则

只收**组成当前 `show` 视图的快照**及其 attempt 产物（`events.json`、`trace.json`），
历史快照不进 fixture。裁剪后的数据必须仍能让 `niceeval show` 完整复现出题时的视图——
这是验收条件：复现不出来，题目的标准答案就没有落点。

## 为什么 fixture 是只读的

数据永不重跑。答案在出题时人工核对一次，之后只要数据不变，答案就不腐烂。这让这组评估
可以当作 **CLI 输出改版的回归面**：`show` 视图、警告文案、命令末尾的「下一步」提示改版
前后各跑一轮，终端视图的信息设计就从「看着清楚」变成了有分数的回归。
