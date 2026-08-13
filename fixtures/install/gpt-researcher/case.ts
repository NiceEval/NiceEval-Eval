import type { ClarifyFacts } from "../../../lib/install/criteria/clarification.ts";
import type { QualityFacts } from "../../../lib/install/criteria/quality.ts";
import type { DocumentationRoutingFacts } from "../../../lib/install/documentation.ts";
import type { FixtureRepo } from "../../../lib/install/fixture.ts";

/** GPT Researcher v3.6.0 的宿主事实；eval 只负责按阶段编排。 */
const transport =
  "自研 WebSocket /ws（FastAPI，默认 0.0.0.0:8000，端点在 backend/server/app.py 而非 server.py）：连上后发" +
  "文本命令 \"start \" 后跟一段 JSON（json.loads(data[6:])，字段含 task / report_type / tone / report_source 等）" +
  "起一次研究；服务端陆续 send_json 推 type=logs（过程，多条）/ images（可选）/ report（正文分段，多条，" +
  "仅 {type,output}）帧，最后一帧 {\"type\":\"path\"} 表示完成（v3.6.0 服务端不发 report_complete，那个 type " +
  "只在前端）。虽然也有 REST（/api/chat 要 report 字段、/report/ 收 task/report_type…）但都不是 OpenAI " +
  "Chat Completions 形状，主路径也不是普通的 REST 请求-响应";

export const gptResearcherCase = {
  fixture: {
    repoUrl: "https://github.com/assafelovic/gpt-researcher.git",
    ref: "v3.6.0",
  } satisfies FixtureRepo,
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(write-send|connect-your-agent)\.mdx|docs-site\/zh\/reference\/events\.mdx/,
  quality: {
    system: "GPT Researcher",
    coreUseCase:
      "自动化研究报告 agent：给一个具体研究主题，它自主上网检索多源资料，产出一篇带引用来源的" +
      "结构化研究报告正文",
    useCaseShape: "一个具体的真实研究主题，期望产出带引用的报告正文",
    assertionPass:
      "断言检查报告正文的实质属性——与主题相关的具体内容、结构化章节、引用来源（URL）等",
    negativeRisk:
      "被测系统自主检索并写报告，最核心的编造风险：给一个虚构的、不可能有可靠来源的主题时，" +
      "它会写出一篇看似有据的报告而不是明确说无法核实。",
  } satisfies QualityFacts,
  clarify: {
    system: "GPT Researcher",
    transport,
    otel:
      "无 OpenTelemetry（全仓 0 命中）。可观测性只有 LangChain 的 LangSmith（LANGCHAIN_TRACING_V2 / " +
      "LANGCHAIN_API_KEY 等环境变量）；服务端 get_config_dict 把 TRACING_V2 兜底成 \"true\"，但缺省没有 API key " +
      "所以不实际上报——对它是「要不要自己补一层 tracing / 提供 key 打开 LangSmith」",
    flags:
      "start 帧的 JSON 支持 report_type（research_report / detailed_report / deep 等）、tone、report_source " +
      "等参数作为研究变体",
  } satisfies ClarifyFacts,
  documentation: {
    relevantPaths: [
      "docs-site/zh/how-to/write-send.mdx",
      "docs-site/zh/how-to/connect-your-agent.mdx",
      "docs-site/zh/tutorials/write-send.mdx",
      "docs-site/zh/tutorials/connect-your-agent.mdx",
      "docs-site/zh/reference/events.mdx",
    ],
    relevantLabel: "读到与宿主形态匹配的页面",
    includeTier: true,
  } satisfies DocumentationRoutingFacts,
};
