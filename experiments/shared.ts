/**
 * 各实验共用的 sandbox 与 agent 装配。
 *
 * 实验之间应该只差一个变量——差别越少，分数差能归因到的东西越明确。
 * 所以除了「有没有安装前引导文档」这一个变量，其余（镜像、模型、runs、预算）全部在这里钉死。
 */

import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";
import { injectCandidate } from "../lib/candidate.ts";

/** 被测 coding agent。模型写在各实验的 model 字段，不写在这里。 */
export const agentUnderTest = codexAgent();

/**
 * sandbox 基线。
 *
 * runtime 固定 node24：安装链里 agent 要跑 pnpm / npx / tsc，Node 版本漂移会
 * 变成一类与文档无关的失败噪声。
 *
 * @param opts.candidateLabel 对比不同 niceeval 版本时传入，取 .candidate/versions/<label>/
 *   下单独 pack 的候选；省略 = 用默认候选（.candidate/）。这个值要跟同一个 experiment
 *   的 `flags.candidateVersion` 保持一致——sandbox 注入哪个候选、机制层拿哪个候选核对版本，
 *   两处各自读一遍这个值，niceeval 不会替你同步。
 */
export function sandboxWith(opts: { withInitDoc: boolean; candidateLabel?: string }) {
  return dockerSandbox({ runtime: "node24" }).setup(injectCandidate(opts));
}

/** 两组共用的运行档位 */
export const RUN_PROFILE = {
  runs: 3,
  maxConcurrency: 2,
} as const;
