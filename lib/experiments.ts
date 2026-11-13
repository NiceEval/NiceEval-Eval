/**
 * 两个实验族的定义。版本是唯一的配置维度：`experiments/<族>/<版本>.ts` 只说被测的是哪个 NiceEval，
 * 其余（被测 agent、模型、沙箱、选题）每个族只有一份，三个候选之间不会漂移。
 *
 * `target` 是精确版本号或 `canary`；加载时由 ensureCandidate 解析成精确版本并写进 flags.candidateVersion，
 * sandbox 里的安装、Eval 的断言与文档页校验都读这一个值。
 */

import { defineExperiment } from "niceeval";
import { ensureCandidate } from "./candidate.ts";
import { harnessSandbox, installSandbox, sandboxCodexAgent } from "./experiment-runtime.ts";

const AGENT_MODEL = "gpt-6.1-sol";

/** 从零接入：agent 只拿到一句 prompt 和该版本 tag 下的 INIT.md。 */
export async function installExperiment(target: string, label: string) {
  const version = await ensureCandidate(target);
  return defineExperiment({
    description: `niceeval@${version}（${label}）：从零接入`,
    adapter: sandboxCodexAgent(),
    model: AGENT_MODEL,
    flags: { candidateVersion: version },
    sandbox: installSandbox(),
    evals: ["install/"],
    attempts: 1,
  });
}

/** 已装好候选的项目里运行、诊断、修复与编写 Eval；agent 拿到的是这个版本的全部：CLI、类型声明与随包文档。 */
export async function harnessExperiment(target: string, label: string) {
  const version = await ensureCandidate(target);
  return defineExperiment({
    description: `niceeval@${version}（${label}）：Harness 运行、反馈与 authoring 闭环`,
    adapter: sandboxCodexAgent(),
    model: AGENT_MODEL,
    reasoningEffort: "medium",
    attempts: 1,
    earlyExit: false,
    flags: { candidateVersion: version, harnessRubric: "v2" },
    sandbox: harnessSandbox(version),
    evals: ["harness/"],
  });
}
