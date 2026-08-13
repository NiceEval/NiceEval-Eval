import type { ClarifyFacts } from "../../../lib/install/criteria/clarification.ts";
import type { QualityFacts } from "../../../lib/install/criteria/quality.ts";
import type { DocumentationRoutingFacts } from "../../../lib/install/documentation.ts";
import type { FixtureRepo } from "../../../lib/install/fixture.ts";

/** Skyvern v1.0.47 的宿主事实；eval 只负责按阶段编排。 */
const coreUseCase =
  "一个用浏览器替你办事的操作型 agent（Skyvern）：给它「打开某个结构稳定的页面（如某维基/商品详情页），" +
  "找到指定字段并返回它的值」，agent 应真的导航到该页、从页面上抽出那个具体字段返回（如价格、版本号、标题）；" +
  "让它抽一个页面上根本不存在的字段，应明确报「找不到 / 页面上没有」而不是编一个看似合理的值";

const transport =
  "异步提交 + 轮询终态的 HTTP（FastAPI，默认端口 8000；base_router 前缀是 /v1，不是 /api/v1）：" +
  "POST /v1/run/tasks 提交任务（body 含 prompt 与起始 url，x-api-key 鉴权，也接受 Authorization: Bearer）拿 run_id，" +
  "再轮询 GET /v1/runs/{run_id} 直到 status 到终态（completed / failed / terminated / canceled / timed_out，" +
  "只等 completed/failed 会永久轮询），从结果的 output 字段取抽取产物。非流式、非 OpenAI 形状";

export const skyvernCase = {
  fixture: {
    repoUrl: "https://github.com/Skyvern-AI/skyvern.git",
    ref: "v1.0.47",
    excludeDirs: ["skyvern-frontend", "docs"],
  } satisfies FixtureRepo,
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/,
  quality: {
    system: "Skyvern",
    coreUseCase,
    useCaseShape: "一个具体的、带起始 URL 与目标字段的浏览器操作/抽取任务",
    assertionPass: "断言检查抽取产物里出现那个具体字段值（价格、版本号、标题等具体内容）",
    negativeRisk:
      "被测系统操作真实网页，最核心的编造风险：让它抽一个页面上根本不存在的字段时，" +
      "它会编一个看似合理的值而不是明确报找不到。",
  } satisfies QualityFacts,
  clarify: {
    system: "Skyvern",
    transport,
    otel:
      "有 OTEL_* 配置项但在 OSS 版里是空壳——OTEL_ENABLED 默认 false，且初始化依赖闭源的 cloud/ 包" +
      "（不在 OSS 树里，设成 true 也只是 warning 后失效）。OSS 真正可用的追踪是 Laminar" +
      "（LMNR_PROJECT_API_KEY 开关兼鉴权，默认关）；另有默认开的 PostHog 匿名产品遥测" +
      "（SKYVERN_TELEMETRY=true）与 structlog 日志，无 Sentry / LangSmith——对它是「接 Laminar / " +
      "还是自己补一层 tracing」",
    flags:
      "run 请求支持 engine（skyvern-1.0 / skyvern-2.0 / openai-cua / anthropic-cua 等）、model、max_steps " +
      "等参数作为变体",
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
