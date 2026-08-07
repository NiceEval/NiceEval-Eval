import { POLICIES } from "./policies.ts";

export function answerPolicyQuestion(question: string): string {
  for (const { pattern, answer } of POLICIES) {
    if (pattern.test(question)) return answer;
  }
  return "I do not have that policy information.";
}
