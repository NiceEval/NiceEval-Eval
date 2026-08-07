import type { O11ySummary } from "niceeval";

/** 给 judge 的不是 agent 自述，而是自述与宿主不可伪造的本轮命令事实。 */
export function turnEvidence(
  candidateVersion: string,
  assistantReply: string,
  shellCommandsObservedByHost: O11ySummary["shellCommands"],
): string {
  return JSON.stringify({ candidateVersion, assistantReply, shellCommandsObservedByHost });
}
