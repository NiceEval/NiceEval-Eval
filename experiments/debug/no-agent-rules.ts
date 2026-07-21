import { defineExperiment } from "niceeval";
import { agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 对照组：不跑 `niceeval init`，AGENTS.md 里没有那段托管区块。
 *
 * 随包文档物理上仍在 `node_modules/niceeval/` 下——它是包的一部分，摘不掉。摘掉的是
 * **通往它的指针**：没有区块，agent 就没被告知「niceeval 不在你的训练数据里，先读
 * INDEX.md」，只能靠 `--help` 和自己翻。
 *
 * 这是结构性隔离，不是任务指令里写一句「不许读文档」那种要求配合——两组题面完全相同，
 * 差值里不掺服从度。路由层照常计量：对照组要是自己摸到了 INDEX.md，那本身就是结论
 * （说明这套文档不靠指针也能被发现），不是需要剔掉的污染。
 */
const NICEEVAL_VERSION = "0.9.1";

export default defineExperiment({
  description: "查结果：AGENTS.md 无 init 托管区块",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { agentRules: false, candidateVersion: NICEEVAL_VERSION },
  sandbox: sandboxWith(),
  evals: ["debug/"],
  runs: 1,
  maxConcurrency: 2,
});
