import { defineJudge } from "niceeval/expect";

/**
 * 二值验收 Judge：材料由调用方用语义字段显式给出（`t.judge({ reply, overview }, yesNo(...))`），
 * rubric 写明满足条件。默认材料上限放宽到能装下一份三件套源码或一组 show 切片；
 * 超限时 NiceEval 记 unavailable，不截断后打分。
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
    maxAuditBytes: 2 * 1024 * 1024,
  });
}
