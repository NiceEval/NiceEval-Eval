import { defineExperiment } from "niceeval";
import { resolveDistTag } from "../../lib/candidate.ts";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 金丝雀组：main 的最新快照，走 canary 预发布通道。
 *
 * 跟 v0.9.1.ts / v0.4.ts 只差版本这一个变量——同一个 model、同一批 eval。「未发版的
 * main」不直接从 git 装：候选身份 = npm 版本号是这套基建的地基（精确复现、INIT.md 按
 * tag 取、安装 gate 对版本号），所以 main 想进对比组，先在 niceeval 仓库的 Actions 里
 * 点一下 Canary workflow（.github/workflows/canary.yml），它会从 main 自动发一个
 * `X.Y.Z-canary.<n>` 到 npm 的 canary dist-tag 并打好 tag。
 *
 * 版本不写死、也不在本地落指针：这里每次加载直接从 npm 的 canary dist-tag 解析「线上最佳
 * 的那版」（v0.9.1 / v0.4 是不可变的已发布版，才该钉死；canary 是移动靶）。发新 canary 后
 * 无需改这个文件，只要把它 pin 出本地 manifest——一条命令搞定：
 *   pnpm canary          # = pin 最新 canary + 跑金丝雀组
 * 或分开：pnpm pin:candidate canary  然后  pnpm install-eval
 */
const NICEEVAL_VERSION = await resolveDistTag("canary");

export default defineExperiment({
  description: `niceeval@${NICEEVAL_VERSION}（main 快照，金丝雀对比组）`,
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["install/"],
  runs: 1,
  maxConcurrency: 2,
});
