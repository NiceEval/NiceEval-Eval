import type { ClarifyFacts } from "../../../lib/install/criteria/clarification.ts";
import type { QualityFacts } from "../../../lib/install/criteria/quality.ts";
import type { DocumentationRoutingFacts } from "../../../lib/install/documentation.ts";
import type { FixtureRepo } from "../../../lib/install/fixture.ts";

/** DB-GPT v0.8.1 的宿主事实；eval 只负责按阶段编排。 */
const transport =
  "纯 HTTP + JSON、SSE 流式、无 WebSocket，默认端口 5670；OpenAI Chat Completions 兼容入口是 " +
  "POST /api/v2/chat/completions（Bearer 鉴权，标准 messages 形状），前端主聊天另走私有形状的 " +
  "/api/v1/chat/completions";

export const dbGptCase = {
  fixture: {
    repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
    ref: "v0.8.1",
    excludeDirs: ["docs", "assets"],
  } satisfies FixtureRepo,
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/,
  quality: {
    system: "DB-GPT",
    coreUseCase:
      "数据库对话式分析平台：用户用自然语言问库表和数据，DB-GPT 经 chat_data / chat_db_qa / " +
      "chat_dashboard 等对话模式（配套 chat_param 指定具体的库）对接真实数据库，生成 SQL / 查询结果 / " +
      "分析；chat_normal 只是裸 LLM 闲聊，不触达任何数据库能力",
    useCaseShape:
      "一个具体的数据问答/分析请求，且 chat_mode 用的是能触达数据库能力的模式" +
      "（chat_data / chat_db_qa / chat_dashboard 等，非 normal 模式配套 chat_param）",
    useCaseBypass:
      "；或在 chat_normal 模式下问通用常识、算术（如 17*23）这类与数据库无关的问题" +
      "——测到的是挂载的底层 LLM，DB-GPT 的差异化能力完全没被碰到",
    assertionPass: "断言检查回答里出现该数据问题应得到的具体结果（具体数值、表名、SQL 片段等）",
    negativeRisk:
      "被测系统对接真实数据库，最核心的编造风险：问一个不存在的库表/字段时，它会编一个看似合理的" +
      "结果集而不是明确报不存在。注意负例必须在真的触达数据库能力的模式下问才成立——chat_normal " +
      "本来就查不了任何表，拒答是必然的，分不出编造与否。",
  } satisfies QualityFacts,
  clarify: {
    system: "DB-GPT",
    transport,
    otel:
      "DB-GPT 自带一套 tracer（默认只写本地 jsonl），并内置可选的标准 OTel / OTLP 导出，默认关" +
      "（需装 observability extra + TRACER_TO_OPEN_TELEMETRY=true）——所以对它不是「有没有 otel」" +
      "的有无题，而是「要不要复用它现成的 tracing / 打开 OTLP 导出」",
    flags:
      "/api/v2/chat/completions 的请求体支持 model（挂载的 LLM）、chat_mode（chat_normal / chat_app / chat_knowledge / " +
      "chat_data / chat_db_qa / chat_dashboard / chat_awel_flow 等对话模式，非 normal 模式还要配套的 chat_param 指定" +
      "具体的库 / 知识库 / 应用）、temperature、max_new_tokens、stream 等参数作为变体",
  } satisfies ClarifyFacts,
  documentation: {
    relevantPaths: [
      "docs-site/zh/how-to/connect-your-agent.mdx",
      "docs-site/zh/how-to/write-send.mdx",
      "docs-site/zh/tutorials/connect-your-agent.mdx",
      "docs-site/zh/tutorials/write-send.mdx",
      "docs-site/zh/tutorials/quickstart.mdx",
    ],
    relevantLabel: "读到与宿主形态匹配的页面",
    includeTier: true,
  } satisfies DocumentationRoutingFacts,
};
