/**
 * 各实验共用的 sandbox 与 agent 装配。
 *
 * 实验之间应该只差一个变量——差别越少，分数差能归因到的东西越明确。
 * 这里只钉死 agent 装配与 sandbox 基线；runs/maxConcurrency 之类的运行档位
 * 各实验自己写，不再共用一个常量。
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
 *   的 `flags.candidateVersion` 保持一致——sandbox 注入哪个候选、「检查 niceeval 是否安装好」
 *   这层拿哪个候选核对版本，两处各自读一遍这个值，niceeval 不会替你同步。
 */
export function sandboxWith(opts: { candidateLabel?: string } = {}) {
  return dockerSandbox({ runtime: "node24" }).setup(injectCandidate(opts));
}
