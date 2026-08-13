import type { ClarifyFacts } from "../../../lib/install/criteria/clarification.ts";
import type { QualityFacts } from "../../../lib/install/criteria/quality.ts";
import type { DocumentationRoutingFacts } from "../../../lib/install/documentation.ts";
import type { FixtureRepo } from "../../../lib/install/fixture.ts";

/** Letta 0.16.8 的宿主事实；eval 只负责按阶段编排。 */
const coreUseCase =
  "一个有状态记忆的对话 agent（Letta / MemGPT）：第一轮告诉它「我叫韩梅梅、正在做一个叫 Orbit 的项目」，" +
  "agent 应把这些事实写进它的记忆块；后续轮问「我叫什么名字、在做什么项目」应准确复述之前说过的具体事实" +
  "（韩梅梅 / Orbit），而不是重新反问或答非所问；问一件从没告诉过它的私人信息（如「我住在哪个城市」）" +
  "应明确说不知道，而不是编一个具体城市名";

const transport =
  "两跳 HTTP（FastAPI，默认端口 8283）：先 POST /v1/agents 建一个 agent 拿 agent_id，再 POST " +
  "/v1/agents/{agent_id}/messages 发消息（非流式，另有 /messages/stream 才流式）；响应是 LettaResponse" +
  "——reasoning / tool_call / assistant 等分型消息的 JSON 列表，非 OpenAI 形状；多轮必须复用同一个 " +
  "agent_id 以维持记忆（同一 agent 禁并发、须串行）；鉴权默认不开，仅 LETTA_SERVER_SECURE=true / " +
  "--secure 时才校验 Authorization: Bearer LETTA_SERVER_PASSWORD";

export const lettaCase = {
  fixture: {
    repoUrl: "https://github.com/letta-ai/letta.git",
    ref: "0.16.8",
  } satisfies FixtureRepo,
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/,
  quality: {
    system: "Letta",
    coreUseCase,
    useCaseShape: "一个具体的、先告诉 agent 某个事实、随后要它复述该事实的多轮记忆场景（复用同一 agent_id）",
    assertionPass:
      "能看到多轮交互（复用会话/agent 状态），且断言后续轮的回答里出现之前提供的那个具体事实" +
      "（如名字「韩梅梅」、项目名「Orbit」）",
    negativeRisk:
      "被测系统是有记忆的 agent，最核心的编造风险：问一件从没告诉过它的私人信息（如所在城市）时，" +
      "它会编一个看似合理的具体值而不是承认不知道。",
  } satisfies QualityFacts,
  clarify: {
    system: "Letta",
    transport,
    otel:
      "有原生 OpenTelemetry（letta/otel/，OTLP gRPC），默认关，且环境变量是非标准名 " +
      "LETTA_OTEL_EXPORTER_OTLP_ENDPOINT + LETTA_DISABLE_TRACING（不是业界标准的 OTEL_ 前缀）；另有 " +
      "Datadog / Sentry 均默认关。开箱即用的追踪只有「provider traces 写库（默认 True）」，经 " +
      "GET /v1/telemetry/{step_id} 读——对它是「设 OTLP 端点 / 读 provider traces / 自己补一层」",
    flags:
      "建 agent 时支持 model、embedding、agent_type（letta_v1_agent / memgpt_agent / memgpt_v2_agent 等）" +
      "作为变体",
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
