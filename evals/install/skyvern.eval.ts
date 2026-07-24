import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE, TIER_PAGE_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import type { ClarifyFacts } from "./share/clarify-criteria.ts";
// 不调用 evalAdapter：起 Skyvern 服务 + 拉浏览器重且不稳，断「真跑通」测到的是环境波动而不是文档效果
//（INIT.md 的完成清单仍要求真跑一次，agent 做不做由交互层/产出质量层如实计分）
import { evalExperiment } from "./share/eval-experiment.ts";
import { evalInstall } from "./share/eval-install.ts";
import { agentSourceMaterial, cloneFixture } from "./share/fixture.ts";
import { buildQualityRubrics, qualityPreamble, type QualityFacts } from "./share/quality-criteria.ts";

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

// 传输事实（按 Skyvern v1.0.47 实测源码填）。一份事实两处用：喂澄清判据的【问接口】，也喂
// 下面 judge 的「传输保真」维度——以前这两处各写一份全文，改一处就漂一处。
const TRANSPORT =
  "异步提交 + 轮询终态的 HTTP（FastAPI，默认端口 8000；base_router 前缀是 /v1，不是 /api/v1）：" +
  "POST /v1/run/tasks 提交任务（body 含 prompt 与起始 url，x-api-key 鉴权，也接受 Authorization: Bearer）拿 run_id，" +
  "再轮询 GET /v1/runs/{run_id} 直到 status 到终态（completed / failed / terminated / canceled / timed_out，" +
  "只等 completed/failed 会永久轮询），从结果的 output 字段取抽取产物。非流式、非 OpenAI 形状";

// 产出质量事实（判据机制见 ./share/quality-criteria.ts）：合格证据形状按 Skyvern v1.0.47
// 实测协议填。CORE_USE_CASE 与上面同源——一份事实多处用。
const QUALITY: QualityFacts = {
  system: "Skyvern",
  coreUseCase: CORE_USE_CASE,
  useCaseShape: "一个具体的、带起始 URL 与目标字段的浏览器操作/抽取任务",
  assertionPass: "断言检查抽取产物里出现那个具体字段值（价格、版本号、标题等具体内容）",
  negativeRisk:
    "被测系统操作真实网页，最核心的编造风险：让它抽一个页面上根本不存在的字段时，" +
    "它会编一个看似合理的值而不是明确报找不到。",
};

// 传输保真判据（就地全文，不走共享构造器——判 adapter 的判据几乎全是本项目协议事实，机制只有
// 末尾两句通用 N 从句，抽共享只剩字符串转发，见 quality-criteria.ts 文件头）。
const TRANSPORT_FIDELITY =
  `${qualityPreamble("Skyvern")}\n` +
  `被测系统是「${CORE_USE_CASE}」，它对外的传输方式是：${TRANSPORT}。\n` +
  `判断：adapter（agent 手写的 send 实现）是否确实走这个「异步提交 + 轮询终态」的 HTTP 协议——` +
  `POST 提交任务拿 run_id、再轮询 GET run 直到终态、从结果里取抽取产物，并映射成 niceeval 的事件流？\n` +
  `合格（Y）：能看到 POST /v1/run/tasks（带 x-api-key、body 有 prompt/url）、拿 run_id、循环 GET ` +
  `/v1/runs/{run_id} 轮询直到终态（completed/failed/terminated/canceled/timed_out）、从 output 解析抽取结果。\n` +
  `不合格（N）：只 POST 一次不轮询、拿不到终态结果；或 adapter 进程内直接 import 并调用 skyvern 的函数；` +
  `或在 adapter 里 spawn/启动 skyvern 进程；或根本没有对应的网络请求。`;

// 项目专属事实，喂澄清判据；判据的机制部分见 ./share/clarify-criteria.ts。这几段是「事实」
// 不是「判据」——只描述 Skyvern 是什么样，不规定 agent 该说什么，judge 拿它做背景核对而非
// 要求逐字复述。
const CLARIFY: ClarifyFacts = {
  system: "Skyvern",
  transport: TRANSPORT,
  otel:
    "有 OTEL_* 配置项但在 OSS 版里是空壳——OTEL_ENABLED 默认 false，且初始化依赖闭源的 cloud/ 包" +
    "（不在 OSS 树里，设成 true 也只是 warning 后失效）。OSS 真正可用的追踪是 Laminar" +
    "（LMNR_PROJECT_API_KEY 开关兼鉴权，默认关）；另有默认开的 PostHog 匿名产品遥测" +
    "（SKYVERN_TELEMETRY=true）与 structlog 日志，无 Sentry / LangSmith——对它是「接 Laminar / " +
    "还是自己补一层 tracing」",
  flags:
    "run 请求支持 engine（skyvern-1.0 / skyvern-2.0 / openai-cua / anthropic-cua 等）、model、max_steps " +
    "等参数作为变体",
};

export default defineScoreEval({
  description: "把 niceeval 接入 Skyvern（浏览器操作自动化 agent）",
  environment: "python",
  // INIT.md 的完成清单含「真跑一次并 show 可见」，agent 大概率会尝试起被测系统，
  // 全局 20min 不够（canary.4 上 gpt-researcher 干到一半被掐死过），install 组统一放宽。
  timeoutMs: 35 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/Skyvern-AI/skyvern.git",
      ref: "v1.0.47",
      excludeDirs: ["skyvern-frontend", "docs"],
    });

    // send 是「用户会原样复制的那句话」：只有读引导 + 装包 + 版本钉死。写三件套、真跑一次、
    // show 可见这些行为要求全部住在 INIT.md 的 TODO 清单里——agent 做没做到是文档的读数，
    // 不由 prompt 代劳。五条接入路径同一份文案。
    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 通用检查：评估安装（gate + 软分混合）+ 评估exp质量（软分）。五条接入路径共用同一套判定。 ──
    await evalInstall(t, { version, clarify: CLARIFY, turn });
    await evalExperiment(t);

    // ── 第二层：产出质量层（judge）。按维度分别判 agent 写出的三件套质量。 ──
    // 一条 find+cat 命令把 agent 手写的 .ts 带路径头串成材料（含 adapter）——「传输方式
    // 对不对」只在 adapter 里看得见；judge 按路径头自行区分 experiment / eval / adapter。
    // skyvern-frontend 已在 clone 时剪掉，这里再兜一层排除。
    const material = await agentSourceMaterial(t.sandbox, ["skyvern-frontend"]);

    await t.group("产出质量层", async () => {
      // 纯加分：每维一条独立 closedQA，Y 挣 1 分、N 挣 0 分，不 gate——没挣到只是没提分。
      // 传输保真就地写全文（判 adapter，见上面 TRANSPORT_FIDELITY）；其余四维判 eval 设计，
      // 机制与反模式从句住 ./share/quality-criteria.ts，事实由上面的 QUALITY 传入。
      t.judge.autoevals.closedQA(`【传输保真】${TRANSPORT_FIDELITY}`, { on: material }).points(1);
      for (const r of buildQualityRubrics(QUALITY)) {
        t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, { on: material }).points(1);
      }
    });

    // ── 第三层：评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；miss 时断言的 received 会带同名 shell 调用的出入参,归因不用手搓。
    await t.group("评估是否正确加载文档", async () => {
      // 本段是「计量，不 gate」（见文件头）：计分制里 .points() 的得分点不参与判定，
      // 没挣到只是少挣分，不会让「文档没起作用」判负。五条接入路径这段写法一致。
      t.calledTool("shell", { input: { command: INDEX_RE } }).points(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).points(1); // 读到与宿主形态匹配的页面
      t.calledTool("shell", { input: { command: TIER_PAGE_RE } }).points(1); // 澄清里要摆的三档只有这页讲
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).points(1); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "skyvern");

    turn.succeeded();
  },
});
