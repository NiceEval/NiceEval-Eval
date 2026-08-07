# 候选题：还原 agent 的实际方案

状态：未来设计稿，不参与 eval discovery。

## 为什么值得保留

用户经常需要知道 agent 实际采用了什么方案，以及多次命令究竟是机械重试还是设计改变。
这是真实 Harness 能力，但当前实现依赖旧 `.niceeval` execution 快照，report/execution reader
仍在变化，因此先不运行。

## 重做方向

- 起始仓库不携带 `.niceeval`；
- 先让 agent 运行一个确定性 experiment，当场生成带工具事件的 attempt；
- 第二轮只问“它刚才实际是怎么做的？”；
- 隐藏判分检查 agent 是否自主找到 locator、读取 execution，并正确区分重试与方案变化。
