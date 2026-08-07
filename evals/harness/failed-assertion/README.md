# 定位失败断言

## 项目

`repo/` 是带真实历史结果的 coding-agent memory 项目。题面给出一条 eval 与一个 experiment，目标
attempt 隐藏在多轮历史执行中；首屏通过率不足以回答失败在哪条断言。

项目源码与 `.niceeval` 一起位于题内，沙箱开始前恢复 `*.ts.fixture` 的原始 TypeScript 文件名，
使 NiceEval 能按历史项目身份解析结果。

## 希望测试的内容

- agent 是否先用 eval / experiment scope 收窄结果，再取得 locator；
- 是否继续执行 `niceeval show @<locator>` 阅读断言详情；
- 是否准确报告失败断言和 locator；
- 是否没有为了回答历史事实而无谓重跑实验或修改仓库。

这题只考 locate；执行轨迹的解释留给 `agent-actual-approach`。
