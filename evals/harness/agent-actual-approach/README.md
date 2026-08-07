# 还原 agent 的实际方案

## 项目

`repo/` 与“定位失败断言”使用事实一致但物理独立的真实项目快照。题面直接给 locator，避免把
“能不能找到 attempt”重复计分；需要的信息只在该 attempt 的执行事件流中。

目标执行里既有具体缓存 API，也有一次补丁上下文不匹配后的机械重试。机械重试不等于设计方案改变。

## 希望测试的内容

- agent 是否自主发现并调用 `niceeval show @<locator> --execution`；
- 是否从工具输出还原实际使用的两个缓存相关 API；
- 是否区分“命令重试”与“换了一套实现方案”；
- 是否保持 repo 只读；若选择读取底层记录，能否仍正确理解 execution 的事件语义。

这题专门覆盖 execution 层，不重复奖励 locator discovery。
