import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
// 不调用 evalAdapter：任务描述没要求 agent 真跑一次（起 Skyvern 服务 + 浏览器重且不稳），evalAdapter 断的正是那件事
import { evalExperiment } from "./share/eval-experiment.ts";
import { evalInstall } from "./share/eval-install.ts";
import { agentSourceMaterial, cloneFixture } from "./share/fixture.ts";

/**
 * 接入路径：真实开源项目 Skyvern（用浏览器替你办事的操作型 agent）。
 *
 * 这条路径的被测行为不是「问答」而是「操作」：给一个自然语言任务 + 起始 URL，agent 真的
 * 开浏览器导航、在页面上抽取字段。协议是异步两跳的轮询——POST /v1/run/tasks 提交任务
 * 拿 run_id，再轮询 GET /v1/runs/{run_id} 直到 status 到终态（completed / failed / terminated /
 * canceled / timed_out），从结果的 output 字段取抽取产物（非流式）。考的是「手写异步提交 +
 * 轮询终态」这条 request/poll 模式，niceeval 没有内置件能直接对上。
 *
 * skyvern-frontend / docs 两个顶层目录与「装 niceeval」无关且 frontend 是 TS，clone 时剪掉——
 * 既省体积，也避免宿主的前端 .ts 混进喂给 judge 的 agent 源码材料里。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 把同一批页面在新旧版本里的两代路径
// 都编进这条正则（0.10.x 起 how-to/ 并入 tutorials/），同一份题库才能横跨新旧候选对比；候选里
// 不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/;

const CORE_USE_CASE =
  "一个用浏览器替你办事的操作型 agent（Skyvern）：给它「打开某个结构稳定的页面（如某维基/商品详情页），" +
  "找到指定字段并返回它的值」，agent 应真的导航到该页、从页面上抽出那个具体字段返回（如价格、版本号、标题）；" +
  "让它抽一个页面上根本不存在的字段，应明确报「找不到 / 页面上没有」而不是编一个看似合理的值";

const TRANSPORT =
  "HTTP POST /v1/run/tasks 提交任务（body 含 prompt 与起始 url，x-api-key 鉴权，也接受 Authorization: Bearer）拿 run_id，" +
  "再轮询 HTTP GET /v1/runs/{run_id} 直到 status 到终态（completed / failed / terminated / canceled / timed_out），" +
  "从结果的 output 字段取抽取产物（异步非流式轮询，默认端口 8000）";

// closeQA 判据（Skyvern 专属）：agent 动手前停下来问对没问对。接口形状与 otel 机制是逐项目
// 的事实，不能写成通用假设——下列按 Skyvern v1.0.47 实测源码填：
//   接口：异步提交 + 轮询终态的 HTTP（FastAPI，默认端口 8000；base_router 前缀是 /v1，非 /api/v1）。
//         POST /v1/run/tasks（body 含 prompt + 起始 url，x-api-key 鉴权、也接受 Authorization: Bearer）
//         拿 run_id；轮询 GET /v1/runs/{run_id} 直到 status 到终态（completed / failed / terminated /
//         canceled / timed_out，只等 completed/failed 会永久轮询），从结果的 output 字段取抽取产物。非流式、非 OpenAI 形状。
//   otel：有 OTEL_* 配置项但在 OSS 里是空壳——OTEL_ENABLED 默认 false，且初始化依赖闭源 cloud/ 包
//         （不在 OSS 树里，设 true 也只是 warning 后失效）。OSS 真正可用的追踪是 Laminar（LMNR_PROJECT_API_KEY
//         开关兼鉴权，默认关）；另有默认开的 PostHog 匿名产品遥测（SKYVERN_TELEMETRY=true）与 structlog 日志。
//         无 Sentry / LangSmith。所以「有没有 otel」对它是「要接 Laminar / 还是自己补一层 tracing」。
const CLARIFY_CRITERIA = `agent 在动手改代码前，先停下来回了用户一条消息做澄清，而不是直接开做。判断这条回复是否同时覆盖以下三个问题：
(1) 确认它要对接的接口 / 传输形状对不对——即它理解的 Skyvern 入口（应是异步提交 + 轮询终态的 HTTP：POST /v1/run/tasks 带 prompt+url、x-api-key 鉴权拿 run_id，再轮询 GET /v1/runs/{run_id} 直到终态 completed/failed/terminated/canceled/timed_out，从 output 字段取抽取产物；非流式、非 OpenAI 形状）是否正确，请用户核对；
(2) 问要不要接 / 复用它的可观测性——Skyvern 的原生 OTLP 在 OSS 版是空壳（默认关且依赖闭源 cloud/ 包），实际可用的追踪是 Laminar（LMNR_PROJECT_API_KEY，默认关），另有默认开的 PostHog 匿名遥测，问用户要不要把 niceeval 接到 Laminar / 或自己补一层 tracing；
(3) 问有没有 flag / 多 prompt 机制——Skyvern 的 run 请求支持 engine（skyvern-1.0 / skyvern-2.0 / openai-cua / anthropic-cua 等）、model、max_steps 等参数作为变体，问用户要不要把这些暴露成 experiment flags 跑对比。
并且按 niceeval 的接入等级（Tier）摆出三档让用户挑（档位讲的是「adapter 接到多深」，与写几个实验无关）：
① Tier 1（只接 send）——不改 Skyvern，只写 adapter 走它的 HTTP 端点提交 + 轮询、把抽取结果映射成 niceeval 事件流，先跑通基线；
② Tier 2（send + OTel）——接 Skyvern 的 Laminar / 或给它补一层 tracing，把 span 也发给 niceeval 看调用瀑布图；
③ Tier 3（侵入 + flags）——把 engine / model / max_steps 等变体暴露成 experiment flags，做引擎 / 模型的 A/B 对比。
合格（Y）：三个问题都问到，且明确摆出这三档接入等级让用户选。
不合格（N）：没停下来直接动手，或回复里没问这些、没给这三档选择。`;

export default defineScoreEval({
  description: "把 niceeval 接入 Skyvern（浏览器操作自动化 agent）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/Skyvern-AI/skyvern.git",
      ref: "v1.0.47",
      excludeDirs: ["skyvern-frontend", "docs"],
    });

    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo, then finish the ` +
        `integration yourself — adapter, eval, and experiment. Nobody is available to confirm decisions with.\n\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 通用检查：评估安装（gate + 软分混合）+ 评估exp质量（软分）。五条接入路径共用同一套判定。 ──
    await evalInstall(t, { version, clarifyCriteria: CLARIFY_CRITERIA, turn });
    await evalExperiment(t);

    // ── 第二层：产出质量层（judge）。按维度分别判 agent 写出的三件套质量。 ──
    // 一条 find+cat 命令把 agent 手写的 .ts 带路径头串成材料（含 adapter）——「传输方式
    // 对不对」只在 adapter 里看得见；judge 按路径头自行区分 experiment / eval / adapter。
    // skyvern-frontend 已在 clone 时剪掉，这里再兜一层排除。
    const material = await agentSourceMaterial(t.sandbox, ["skyvern-frontend"]);

    const DIMENSIONS: { key: string; threshold: number; criteria: string }[] = [
      {
        key: "传输保真",
        threshold: 0.7,
        criteria: `被测系统是「${CORE_USE_CASE}」，它对外的传输方式是：${TRANSPORT}。
判断：adapter（agent 手写的 send 实现）是否确实走这个「异步提交 + 轮询终态」的 HTTP 协议——POST 提交任务拿 run_id、
再轮询 GET run 直到终态、从结果里取抽取产物，并映射成 niceeval 的事件流？
合格（Y）：能看到 POST /v1/run/tasks（带 x-api-key、body 有 prompt/url）、拿 run_id、循环 GET /v1/runs/{run_id} 轮询直到终态（completed/failed/terminated/canceled/timed_out）、从 output 解析抽取结果。
不合格（N）：adapter 进程内直接 import 并调用 skyvern 的函数；或在 adapter 里 spawn/启动 skyvern 进程；或只 POST 一次不轮询、拿不到终态结果；或根本没有对应的网络请求。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写——一个具体的、带起始 URL 的浏览器操作/抽取任务？
不合格（N）：输入是 "hello" / "你好" / "test" / "帮我上网查查" 这类没有具体页面与目标字段的寒暄或占位内容。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了这个抽取任务应得到的具体结果，而不是只判任务跑完？
合格（Y）：断言检查抽取产物里出现那个具体字段值（价格、版本号、标题等具体内容），用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「任务 status 是 completed」「有结果」这类与抽取内容无关的判定。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统操作真实网页，最核心的风险是：让它抽一个页面上根本不存在的字段时，它会编一个看似合理的值而不是明确报找不到。
判断：eval 是否包含一条针对这个负例的用例——让 agent 抽一个页面上不存在的字段，断言它明确报「找不到 / 页面上没有」且没有编造出一个具体值？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 Skyvern 浏览器操作 agent，而不是各写各的、互不搭界？
不合格（N）：experiment 用的是 echoAgent / 通用占位 agent，或引用的 agent 与 eval 的被测系统看不出关联。`,
      },
    ];

    await t.group("产出质量层", async () => {
      // judge 是软分（severity=soft），不 gate verdict——只把「装好了但产出质量差」量化出来。
      for (const d of DIMENSIONS) {
        t.judge.autoevals.closedQA(`【${d.key}】${d.criteria}`, { on: material }).atLeast(d.threshold);
      }
    });

    // ── 第三层：评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；miss 时断言的 received 会带同名 shell 调用的出入参,归因不用手搓。
    await t.group("评估是否正确加载文档", async () => {
      // .soft()：本段是「计量，不 gate」（见文件头），而 calledTool/notCalledTool 默认
      // severity 是 gate、.points() 与 severity 正交不降级——漏了 .soft() 会让「文档没
      // 起作用」直接判负，与本层只计量的设计相悖。五条接入路径这段写法一致：计分 + soft。
      t.calledTool("shell", { input: { command: INDEX_RE } }).points(1).soft(); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).points(1).soft(); // 读到与宿主形态匹配的页面
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).points(1).soft(); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "skyvern");

    turn.succeeded();
  },
});
