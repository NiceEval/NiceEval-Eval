# 过期实验概览

## 项目

`repo/` 是一个真实的 coding-agent memory 评测项目切片，包含多个 compare experiment、11 条评估
用例及其历史运行。当前视图由多轮执行合并而成，因此既有“结果时间落后于输入”的过期警告，也有
“当前结果没有覆盖历史上出现过的全部 eval”的覆盖警告。

仓库内的历史结果只读；沙箱准备阶段安装 NiceEval 0.9.1 reader。有 agent rules 的实验还会运行
`niceeval init`，除此之外两组输入完全一致。

## 希望测试的内容

- agent 是否先从 `niceeval show` 首屏识别所有被标记的 experiment；
- 是否区分过期原因，而不是把低通过率误称为“过期”；
- 是否抄出 CLI 给出的精确重跑命令，但不真的执行；
- 是否遵守公共 CLI、只读仓库和随包文档路由边界。

这题选作 overview 入口；它不考单 attempt 细节，后续题会逐层下钻。
