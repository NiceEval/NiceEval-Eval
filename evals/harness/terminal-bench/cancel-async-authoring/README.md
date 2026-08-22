# cancel-async authoring Harness

这道题不让 coding agent 修业务代码，而是让它把一份真实 Terminal-Bench 原题包接成正式
NiceEval Eval。题包来自 `terminal-bench@5964952` 的 `cancel-async-tasks`：官方题面、测试、
联网版 `run-tests.sh` 与参考解答保持原样；Harness 只额外提供一个离线 runner，跳过依赖下载并
逐个执行同一份官方测试函数。

评分完全确定性，总分 16：

- 1 分：只创建指定 Eval；
- 2 分：题面、Docker fixture、官方测试、runner 与参考答案均未被篡改；
- 2 分：Eval 可发现并完成 link plan；
- 6 分：oracle 的官方参考实现得到恰好 1 passed / 0 failed / 0 errored；
- 2 分：只给官方测试追加无行为变化的注释后，oracle 自动重跑且报告 0 reused；
- 3 分：leak-probe 得到恰好 0 passed / 1 failed / 0 errored。

`leak-probe` 是时间边界检查，不是弱答案样例。它会在 `t.send()` 内检查 task sandbox 是否已
出现 tests、runner 或 solution：若发现泄漏，就写入正确参考实现；若没有泄漏，才写入一个会
违反并发要求的实现。因此，正确 Eval 下它必须是普通 failed；提前上传隐藏材料、把它放进
Docker build context，或写出无效 verifier，都会让负向探针意外通过并丢分。

外层不根据最终回复措辞给分，也不使用 LLM judge。`.niceeval/` 仍是唯一禁止直接读取的私有
结果路径；读取题包、agent、experiment 与 bundled docs 都是合法工作。
