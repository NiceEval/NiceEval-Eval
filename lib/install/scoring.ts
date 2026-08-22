/** install 正式题与 roadmap 预览题共用的评分模式。 */
export type InstallScoringMode = "additive" | "outcome-weighted";

/**
 * outcome-weighted 模式只提升真实闭环的分值；其余细粒度 rubric 继续每项 1 分。
 * 两道正式 install 题在没有 tsconfig 时可得 93 分，有 tsconfig 且 typecheck 干净时可得 94 分。
 */
export const INSTALL_OUTCOME_POINTS = {
  assistantEvent: 8,
  completedTurn: 3,
  foundation: 3,
  inspectedResults: 5,
  ranExperiment: 8,
  showSucceeded: 3,
  terminalResult: 8,
} as const;

export function isOutcomeWeighted(mode: InstallScoringMode | undefined): boolean {
  return mode === "outcome-weighted";
}
