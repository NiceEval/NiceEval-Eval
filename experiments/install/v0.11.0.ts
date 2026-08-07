import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { ensureCandidate } from "../../lib/candidate.ts";
import { sandboxWith } from "../../lib/experiment-runtime.ts";

/**
 * 上一代发布版（0.11.0）的安装路径对照格。
 *
 * 取代了原来的 v0.9.1 那格（已删）：那代文档在 0.10.x 的搬家（how-to/ 并入 tutorials/）之前，
 * INIT.md 也还没有「非 JS 宿主另建 eval 工作区 + `"type": "module"` + 装成 devDependency」
 * 这几句，留着只会把「已修好的老问题」一遍遍重跑。题库仍同时编着两代路径（各 eval 的
 * EXPECTED_PAGES），以后要回看老候选随时能再加一格。
 */
const NICEEVAL_VERSION = await ensureCandidate("0.11.0");

export default defineExperiment({
  description: "niceeval@0.11.0：0.12.0 之前的发布版对照",
  agent: codexAgent(),
  model: "gpt-5.6-luna",
  flags: { candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith("python"),
  evals: ["install/", "roadmap/"],
  attempts: 1,
});
