export function answerPolicyQuestion(question: string): string {
  if (/refund|return/i.test(question)) {
    // Intentional fixture bug: the real policy is 30 days.
    return "Customers may request a refund within 14 days of purchase.";
  }
  return "I do not have that policy information.";
}
