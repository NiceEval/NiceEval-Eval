/**
 * 实验族的定义。版本是唯一的配置维度：`experiments/<族>/<版本>.ts` 只说被测的是哪个 NiceEval，
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

/** 已装好候选的项目里运行、诊断、修复与编写 Eval；agent 只能依靠随包文档。 */
export function harnessExperiment(target: string, label: string) {
  return harness(target, `（${label}）：Harness 运行、反馈与 authoring 闭环`, "kept");
}

/**
 * 文档消融对照：同一个候选、同一套 Harness 题，随包文档与 init 指引块被删掉。
 * 与同版本 harness 族的分差是文档的贡献；删了文档分数不变的题测的是模型本身。
 */
export function harnessWithoutDocsExperiment(target: string, label: string) {
  return harness(target, `（${label}）：Harness，无随包文档`, "stripped");
}

async function harness(target: string, description: string, bundledDocs: "kept" | "stripped") {
  const version = await ensureCandidate(target);
  return defineExperiment({
    description: `niceeval@${version}${description}`,
    adapter: sandboxCodexAgent(),
    model: AGENT_MODEL,
    reasoningEffort: "medium",
    attempts: 1,
    earlyExit: false,
    // 有文档的族不带 bundledDocs，已有结果的身份不变。
    flags: { candidateVersion: version, harnessRubric: "v2", ...(bundledDocs === "stripped" ? { bundledDocs } : {}) },
    sandbox: harnessSandbox(version, { bundledDocs }),
    evals: ["harness/"],
  });
}
