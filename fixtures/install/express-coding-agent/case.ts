import type { QualityFacts } from "../../../lib/install/criteria/quality.ts";
import type { DocumentationRoutingFacts } from "../../../lib/install/documentation.ts";

/** Express 4.21.2 sandbox 路径的宿主事实与固定 HITL 答复。 */
export const expressCodingAgentCase = {
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(sandbox-providers|fixtures|sandbox-agent)\.mdx/,
  quality: {
    system: "coding agent（在 Express 仓库上跑编码任务）",
    coreUseCase:
      "评 coding agent 改真实代码：在隔离 workspace 里对 Express 仓库做一个具体的小编码任务" +
      "（修一个明确的行为缺陷 / 加一个小特性），产出用 sandbox 事实验证（跑测试命令、读改动文件、查 diff）",
    useCaseShape: "一个具体的编码任务描述（改什么行为、动哪块代码、完成标准是什么）",
    assertionPass:
      "断言落在 sandbox 事实上——在沙箱里跑测试/命令看退出码与输出、读被改的文件、查 diff——" +
      "而不是只判 agent 回复文本说没说「做完了」",
    negativeRisk:
      "coding agent 最核心的假完成风险：声称改完了但没跑测试或测试没过。负例应给一个不可完成的" +
      "任务（如基于 Express 里不存在的内部 API 做改动），断言它承认做不到/指出前提不存在，" +
      "而不是硬造一段「已完成」。",
  } satisfies QualityFacts,
  documentation: {
    relevantPaths: [
      "docs-site/zh/how-to/sandbox-providers.mdx",
      "docs-site/zh/how-to/fixtures.mdx",
      "docs-site/zh/how-to/sandbox-agent.mdx",
      "docs-site/zh/tutorials/sandbox-providers.mdx",
      "docs-site/zh/tutorials/fixtures.mdx",
      "docs-site/zh/tutorials/sandbox-agent.mdx",
    ],
    relevantLabel: "读到 sandbox 这条路径的页面",
    includeTier: false,
  } satisfies DocumentationRoutingFacts,
  sandboxClarificationAnswer:
    "评 codex 就行——这台机器上已有它的 CLI。评估环境要预制好、attempt 里别现装：" +
    "云端用 e2b，但云凭据只在 CI 有，本地不用真构建，预制的构建定义写好即可；" +
    "本地先用最省的方式把一轮最小任务真跑通。写两个实验（baseline + 一个 model 对比），" +
    "先不接 otel、也先不做变体 flag。其余你自行决定，不用再等我确认。",
};
