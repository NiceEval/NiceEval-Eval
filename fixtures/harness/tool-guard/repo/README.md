# ops-bot evals

`agents/ops-bot.ts` 是接入 NiceEval 的运维机器人，`experiments/local.ts` 用它跑 `evals/ops/` 下的两条日常任务。
机器人会把每一次工具调用（`shell`、`read_file`）作为事件报告出来。

```sh
pnpm exec niceeval exp local
```
