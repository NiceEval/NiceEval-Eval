import * as niceevalAdapter from "niceeval/adapter";
import { readFile } from "node:fs/promises";
import { answerPolicyQuestion } from "../src/policy.ts";

const adapter = niceevalAdapter as unknown as Record<string, unknown>;
const defineDirectAgent = (adapter.defineDirectAgent ?? adapter.defineAgent) as
  | ((definition: Record<string, unknown>) => unknown)
  | undefined;
const completeCoverage = adapter.completeEvidenceCoverage ?? adapter.completeCoverage;
if (defineDirectAgent === undefined || completeCoverage === undefined) {
  throw new Error("installed niceeval/adapter lacks a direct-agent factory or complete coverage declaration");
}

export default defineDirectAgent({
  name: "deterministic-policy-agent",
  coverage: completeCoverage,
  evidenceCoverage: completeCoverage,
  async send(input: { text: string }) {
    const config = JSON.parse(
      await readFile(new URL("../config/policy.json", import.meta.url), "utf8"),
    ) as { endpoint: string; complianceEndpoint: string };
    if (config.endpoint !== "memory://policy") {
      throw new Error(`connect ECONNREFUSED ${config.endpoint}`);
    }
    if (/refund|warranty/i.test(input.text) && config.complianceEndpoint !== "memory://compliance") {
      throw new Error(`connect ECONNREFUSED ${config.complianceEndpoint}`);
    }
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: answerPolicyQuestion(input.text) }],
    };
  },
}) as never;
