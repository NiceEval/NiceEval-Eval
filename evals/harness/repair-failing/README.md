# 修复必失败实验

`repo/` 的 `local` experiment 会因业务源码返回错误值而稳定失败。这题检查 agent 是否会
用 locator 下钻证据，只修 `src/policy.ts`，然后局部重跑到全绿。
