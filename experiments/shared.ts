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
import { provisionTargetAppEnv } from "../lib/fixture-env.ts";

/** 被测 coding agent。模型写在各实验的 model 字段，不写在这里。 */
export const agentUnderTest = codexAgent();

/**
 * sandbox 基线。
 *
 * runtime 固定 node24：安装链里 agent 要跑 pnpm / npx / tsc，Node 版本漂移会
 * 变成一类与文档无关的失败噪声。
 *
 * @param version 被评的 niceeval 版本，取 .candidate/<version>/ 下钉好的那份。
 *   同一个值也要写进 experiment 的 `flags.candidateVersion`——sandbox 投放哪个版本的
 *   引导文档、eval 让 agent 装哪个版本、「检查 niceeval 是否安装好」这层核对哪个版本，
 *   三处读的都是它，niceeval 不会替你同步。
 */
export function sandboxWith(version: string) {
  return dockerSandbox({ runtime: "node24" }).setup(injectCandidate(version)).setup(provisionTargetAppEnv());
}
