import { defineJudge } from "niceeval/expect";

/** 二值 rubric 只有 0 与 1 两个 anchor，gate 取两者中点：判为满足才放行。 */
export const YES = 0.5;

/**
 * 二值验收 Judge：材料由调用方用语义字段显式给出（`t.judge({ reply, overview }, yesNo(...))`），
 * rubric 写明满足条件。材料上限容纳首轮完整的命令与回复；需要进 Sandbox 取证的判据改用 defineAgentJudge。
 * 超限时保留 unavailable。
 */
export function yesNo(name: string, rubric: string) {
  return defineJudge({
    name,
    rubric,
    anchors: [
      { measurement: 0, description: "不满足 rubric 的条件" },
      { measurement: 1, description: "完全满足 rubric 的条件" },
    ],
    maxMaterialBytes: 512 * 1024,
    maxAuditBytes: 1024 * 1024,
  });
}
