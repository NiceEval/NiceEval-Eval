import { defineExperiment } from "niceeval";
import { RUN_PROFILE, agentUnderTest, sandboxWith } from "../shared.ts";

/**
 * 对照组：不给安装前引导文档，agent 凭训练记忆装。
 *
 * 与实验组的差值，就是 INIT.md 这一段引导带来的增量。
 *
 * 边界说明（重要，别过度解读这组分数）：
 * 随包文档（node_modules/niceeval/INDEX.md 与 docs-site/zh/**）是包的一部分，
 * agent 一旦装上包就必然存在，没法在这一组里移除。所以这两组的差值度量的是
 * **安装前引导链**的增量，不是「随包文档」的增量。随包文档起没起作用由路由层
 * 单独计量——两组的路由层分数放在一起看，才是随包文档的证据。
 */
export default defineExperiment({
  description: "无安装前引导文档，凭训练记忆裸装",
  agent: agentUnderTest,
  model: "gpt-5.4",
  flags: { initDoc: false },
  sandbox: sandboxWith({ withInitDoc: false }),
  ...RUN_PROFILE,
});
