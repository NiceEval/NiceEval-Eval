import { defineExperiment } from "niceeval";
import { ensureCandidate } from "../../lib/candidate.ts";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 当前 npm latest（0.11.0），install 组的基线格。跟 canary.ts 只差版本这一个变量——同一个
 * model、同一批 eval，分数差才归因得到「文档变了」。
 *
 * 取代了原来的 v0.9.1 那格（已删）：那代文档在 0.10.x 的搬家（how-to/ 并入 tutorials/）之前，
 * INIT.md 也还没有「非 JS 宿主另建 eval 工作区 + `"type": "module"` + 装成 devDependency」
 * 这几句，留着只会把「已修好的老问题」一遍遍重跑。题库仍同时编着两代路径（各 eval 的
 * EXPECTED_PAGES），以后要回看老候选随时能再加一格。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.11.0");

export default defineExperiment({
  description: "niceeval@0.11.0：INIT.md + 随包文档（当前 latest）",
  agent: agentUnderTest,
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["install/"],
  runs: 1,
  maxConcurrency: 2,
});
