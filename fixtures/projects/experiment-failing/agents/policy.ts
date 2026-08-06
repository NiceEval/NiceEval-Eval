import { completeEvidenceCoverage, defineDirectAgent } from "niceeval/adapter";
import { answerPolicyQuestion } from "../src/policy.ts";

export default defineDirectAgent({
  name: "deterministic-policy-agent",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input) {
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: answerPolicyQuestion(input.text) }],
    };
  },
});
