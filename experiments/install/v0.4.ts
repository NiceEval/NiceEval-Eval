import { defineExperiment } from "niceeval";
import { RUN_PROFILE, agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 版本对比组：niceeval@0.4.x。
 *
 * 跟 v0.9.ts 只差 candidate 这一个变量——同一个 model、同一批 eval、同样投放
 * 安装前引导文档。文档本身也是版本对齐的：candidateLabel 对应的 INIT.md 是
 * 0.4.1 发布时那份，不是今天 niceeval.com 上的最新文案（见 scripts/pack-candidate.ts）。
 *
 * 用前先打好这个 label 对应的候选：
 *   pnpm run pack:candidate -- 0.4.1 v0.4
 */
const CANDIDATE_LABEL = "v0.4";

export default defineExperiment({
  description: "niceeval@0.4.1（版本对比组）",
  agent: agentUnderTest,
  model: "gpt-5.4",
  // flags.candidateVersion 给机制层核对版本；sandbox 的 candidateLabel 决定注入哪份候选。
  // niceeval 不会替这两处同步，同一个变量写两遍，至少不会在这个文件内部打错成两个值。
  flags: { initDoc: true, candidateVersion: CANDIDATE_LABEL },
  sandbox: sandboxWith({ withInitDoc: true, candidateLabel: CANDIDATE_LABEL }),
  ...RUN_PROFILE,
});
