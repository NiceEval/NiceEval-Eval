import type { ScoreTestContext } from "niceeval";
import { buildQualityRubrics, type QualityFacts } from "./criteria/quality.ts";

/** 按四个独立维度给 agent 写出的 Eval 设计计分，不改变 verdict。 */
export async function scoreEvalDesign(
  t: ScoreTestContext,
  facts: QualityFacts,
  material: { input: string; output: string },
): Promise<void> {
  await t.group("产出质量层", async () => {
    for (const [index, rubric] of buildQualityRubrics(facts).entries()) {
      t.judge.autoevals.closedQA(`【${rubric.key}】${rubric.criteria}`, material)
        .score(1)
        .key(`install.quality.eval-design.${index + 1}`)
        .label(rubric.key);
    }
  });
}
