import type { ClarifyFacts } from "../../../lib/install/criteria/clarification.ts";
import type { QualityFacts } from "../../../lib/install/criteria/quality.ts";
import type { DocumentationRoutingFacts } from "../../../lib/install/documentation.ts";
import type { FixtureRepo } from "../../../lib/install/fixture.ts";

/** OpenHands 1.11.0 的宿主事实；eval 只负责按阶段编排。 */
const coreUseCase =
  "一个能读写代码、跑命令的自主编码 agent（OpenHands）：给它一个明确的小任务，如「写一个函数计算斐波那契" +
  "第 10 项，运行它，并把结果打印出来」，agent 应真的创建/编辑文件、执行代码，并在完成时给出那个确定的" +
  "结果（第 10 项 = 55）；给它一个信息不足、明显无法完成的任务，不应假装完成、编一个结果";

const transport =
  "OpenHands 1.11.0 的新 app_server（FastAPI，/api/v1，默认端口 3000）：先 POST /api/v1/app-conversations " +
  "建会话拿 conversation_id，再 POST /api/v1/app-conversations/{id}/send-message 发任务；读结果要么轮询宿主侧 " +
  "GET /conversation/{id}/events（无 SSE / WS），要么连进 sandbox 内 agent server 的原生 WebSocket " +
  "/sockets/events/{id}?session_api_key=（承载 SDK 的 ActionEvent / ObservationEvent），映射成 niceeval 事件流" +
  "直到 agent 结束（app_server 是薄代理、agent 实跑在 sandbox 内独立的 agent server / openhands-agent-server 包；" +
  "非 OpenAI 形状；旧版 Socket.IO oh_event/oh_user_action 已删除，别用）";

export const openhandsCase = {
  fixture: {
    repoUrl: "https://github.com/OpenHands/OpenHands.git",
    ref: "1.11.0",
    excludeDirs: ["docs", "frontend", "evaluation"],
  } satisfies FixtureRepo,
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(write-send|connect-your-agent)\.mdx|docs-site\/zh\/reference\/events\.mdx/,
  quality: {
    system: "OpenHands",
    coreUseCase,
    useCaseShape: "一个具体的、结果确定可核对的小编码任务",
    assertionPass: "断言检查产出里出现那个确定结果（如斐波那契第 10 项 = 55，或某段代码的具体运行输出）",
    negativeRisk:
      "被测系统是能自主干活的编码 agent，最核心的编造风险：给它一个信息不足、无法完成的任务时，" +
      "它会假装完成、编一个看似合理的结果。",
  } satisfies QualityFacts,
  clarify: {
    system: "OpenHands",
    transport,
    otel:
      "无内置 OTLP 接线——opentelemetry 只是个没用上的 pin 依赖，宿主没有 OTEL_ 开关、不产 trace。" +
      "唯一内置遥测是 PostHog，且后端事件仅企业版开、OSS 默认只有前端匿名上报（POSTHOG_CLIENT_KEY + " +
      "user_consents_to_analytics 设置）；无 Sentry / Langfuse。可观测性实际只有结构化日志（LOG_JSON）" +
      "——对它是「没有现成 otel，要不要自己补一层 tracing」",
    flags:
      "建会话支持 agent_type（default / plan）、llm_model、agent_profile_id、max_iterations、" +
      "max_budget_per_task 等参数作为变体",
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
