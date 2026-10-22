import { defineMaterialMatch, satisfies } from "niceeval/expect";

/** 显式保留每条判据原来的材料范围，交给 0.19 的二值 closeQA。 */
export function judgeEvidence(material: { input: string; output: string }) {
  return defineMaterialMatch<unknown, typeof material>({
    name: "evaluation-evidence",
    read: () => ({ state: "complete", items: [{ id: "evidence", value: material }] }),
    match: satisfies("完整判据材料", () => true),
  });
}
