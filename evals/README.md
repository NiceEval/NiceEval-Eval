# 本仓库 Eval 的写法

我们用 NiceEval 品味评被测 agent 写的 Eval，自己写的题也要过同一把尺子。读一个 `eval.ts`，应当从上到下看出：用户说了什么、被测 agent 做了什么、哪些事实算通过、各值几分。

## 结构

1. 顶部：fixture 路径、题面原文与用户画像等常量。
2. `test(t)`：发送题面 → 等被测会话结束 → 平铺判据。外层准备与验收运行写成一句调用，细节在 `lib/` 或题目旁的辅助模块。
3. 判据一条一行，从上到下就是评分表。

## 判据

- **事实用 Match 断言值本身**，不先算成布尔值再交给 `equals(true)`。例如断言 `verdict` 等于 `"failed"`、文件内容包含某句话，失败时能直接看到实际值。可用的 Match 以 `node_modules/niceeval/INDEX.md` 为准。
- **文件改动用 NiceEval 的 agent 归因 diff 断言**（`t.sandbox.fileChanged`、`changedPaths`、`changedOnlyWithin`、`unchangedWithin` 等），不手写快照再比较字符串。
- **读被测项目结果的管道放进 `lib/query.ts`**，返回领域值（例如某道题当前发布的 Attempt 的 verdict 与 locator）；正文只断言这个值。版本差异与缺字段的报错在 `lib/` 处理。
- **门槛与计分的写法统一**：`.gate()` 表示不满足即失败，`.score(n)` 表示计分，计分制里两者可以同时用于一条判据（必须满足且计分）。顺序固定为 `.gate().score(n).label(...)`，需要停止后续步骤时最后接 `.orStop()`；只有连续分数才给 `.gate(minimum)` 传下限。
- **label 是简短陈述**，说明满足时意味着什么，例如“第一轮跑出退款题的 failed 结果”；不复用整段用户原话。
- **Judge 判据写成可核对的陈述句**，例如“回复明确说退款题未通过，并指出客服答的是 7 天、新要求是 5 个工作日”，不写成问句。
- **评审者与模拟用户**分别使用 [`judges/`](judges/README.md) 与 [`users/`](users/README.md) 的共享定义；题目只写自己的判据与画像。

## 例子

```ts
const first = await t.send(FIRST_REQUEST);
first.succeeded().label("第一轮完成");
const refund = await publishedAttempt(shell, "local", REFUND_EVAL);
t.check(refund?.verdict, equals("failed")).gate().score(3).label("第一轮真的跑出退款题的 failed 结果");
t.judge(first.reply, binaryJudge({ rubric: "回复明确说退款题未通过，并指出客服答的是 7 天、新要求是 5 个工作日。" }))
  .score(2).label("说清退款题为什么失败");
```

`publishedAttempt` 是 `lib/query.ts` 的取数函数，找不到结果时返回 `null`，断言会如实显示实际值。
