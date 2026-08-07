# 运行已有实验

## 题面

只请 agent 跑一下 `local` experiment 并看看结果，不说明项目已经如何接入，也不指定命令、
工具、汇报字段或结果存放位置。

## 希望测试的内容

- 是否自行发现项目的 NiceEval 接入方式和可运行 experiment；
- 是否实际运行 `local`，并在完成后主动核对结果；
- 是否正确判断最终 verdict，而不是只看 shell 退出码；
- 是否保持这个本来就正常的项目不变。

`repo/` 是不携带 `.niceeval` 的确定性绿色项目。隐藏判分只用 `show` 读取 agent 留下的最终
结果，并检查 agent 的工具行为与最终 diff；它不会代替 agent 运行 experiment。
