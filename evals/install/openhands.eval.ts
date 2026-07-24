import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE, TIER_PAGE_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import type { ClarifyFacts } from "./share/clarify-criteria.ts";
// 不调用 evalAdapter：起 OpenHands app_server + sandbox 内 agent server 重且不稳，断「真跑通」测到的是
// 环境波动而不是文档效果（INIT.md 的完成清单仍要求真跑一次，agent 做不做由交互层/产出质量层如实计分）
import { evalExperiment } from "./share/eval-experiment.ts";
import { evalInstall } from "./share/eval-install.ts";
import { agentSourceMaterial, cloneFixture } from "./share/fixture.ts";

/**
 * 接入路径：真实开源项目 OpenHands（前身 OpenDevin，自主编码 agent）。
 *
 * 被测行为是「干活」而不是「问答」：给一个明确的编码任务，agent 真的建文件、写代码、跑命令，
 * 从一串 action / observation 事件里推进到完成。1.11.0 的对外接口是新的 app_server（FastAPI，
 * /api/v1，默认端口 3000）：先 POST /api/v1/app-conversations 建会话拿 conversation_id，再
 * POST /api/v1/app-conversations/{id}/send-message 发任务，然后要么轮询宿主侧 GET
 * /conversation/{id}/events，要么连进 sandbox 内 agent server 的原生 WebSocket /sockets/events/{id}
 * 读 SDK 的 ActionEvent / ObservationEvent，映射成 niceeval 的事件流直到 agent 结束。app_server
 * 只是薄代理，真正的 agent 跑在 sandbox 内独立的 agent server（openhands-agent-server 包）——这条
 * 两层架构 + SDK 事件模型是本路径独有的难点。
 *
 * 注意：旧版（V1 之前）的 Socket.IO oh_event / oh_user_action + /api/conversations 协议在 1.11.0
 * 后端已删除（源码注 socketio is no longer used），只在前端留了死路径——别照那套写。
 *
 * docs / frontend / evaluation 三个顶层目录与「装 niceeval」无关且 frontend 是 TS，clone 时剪掉——
 * 既省体积，也避免宿主的前端 .ts 混进喂给 judge 的 agent 源码材料里。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 把同一批页面在新旧版本里的两代路径
// 都编进这条正则（0.10.x 起 how-to/ 并入 tutorials/），同一份题库才能横跨新旧候选对比；候选里
// 不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(write-send|connect-your-agent)\.mdx|docs-site\/zh\/reference\/events\.mdx/;

const CORE_USE_CASE =
  "一个能读写代码、跑命令的自主编码 agent（OpenHands）：给它一个明确的小任务，如「写一个函数计算斐波那契" +
  "第 10 项，运行它，并把结果打印出来」，agent 应真的创建/编辑文件、执行代码，并在完成时给出那个确定的" +
  "结果（第 10 项 = 55）；给它一个信息不足、明显无法完成的任务，不应假装完成、编一个结果";

// 传输事实（按 OpenHands 1.11.0 实测源码填；1.11.0 已整体改写，旧的 /api/conversations +
// Socket.IO oh_event/oh_user_action 后端已删除）。一份事实两处用：喂澄清判据的【问接口】，
// 也喂下面 judge 的「传输保真」维度——以前这两处各写一份全文，改一处就漂一处。
const TRANSPORT =
  "OpenHands 1.11.0 的新 app_server（FastAPI，/api/v1，默认端口 3000）：先 POST /api/v1/app-conversations " +
  "建会话拿 conversation_id，再 POST /api/v1/app-conversations/{id}/send-message 发任务；读结果要么轮询宿主侧 " +
  "GET /conversation/{id}/events（无 SSE / WS），要么连进 sandbox 内 agent server 的原生 WebSocket " +
  "/sockets/events/{id}?session_api_key=（承载 SDK 的 ActionEvent / ObservationEvent），映射成 niceeval 事件流" +
  "直到 agent 结束（app_server 是薄代理、agent 实跑在 sandbox 内独立的 agent server / openhands-agent-server 包；" +
  "非 OpenAI 形状；旧版 Socket.IO oh_event/oh_user_action 已删除，别用）";

// 项目专属事实，喂澄清判据；判据的机制部分见 ./share/clarify-criteria.ts。这几段是「事实」
// 不是「判据」——只描述 OpenHands 是什么样，不规定 agent 该说什么，judge 拿它做背景核对而非
// 要求逐字复述。
const CLARIFY: ClarifyFacts = {
  system: "OpenHands",
  transport: TRANSPORT,
  otel:
    "无内置 OTLP 接线——opentelemetry 只是个没用上的 pin 依赖，宿主没有 OTEL_ 开关、不产 trace。" +
    "唯一内置遥测是 PostHog，且后端事件仅企业版开、OSS 默认只有前端匿名上报（POSTHOG_CLIENT_KEY + " +
    "user_consents_to_analytics 设置）；无 Sentry / Langfuse。可观测性实际只有结构化日志（LOG_JSON）" +
    "——对它是「没有现成 otel，要不要自己补一层 tracing」",
  flags:
    "建会话支持 agent_type（default / plan）、llm_model、agent_profile_id、max_iterations、" +
    "max_budget_per_task 等参数作为变体",
};

export default defineScoreEval({
  description: "把 niceeval 接入 OpenHands（自主编码 agent）",
  environment: "python",
  // INIT.md 的完成清单含「真跑一次并 show 可见」，agent 大概率会尝试起被测系统，
  // 全局 20min 不够（canary.4 上 gpt-researcher 干到一半被掐死过），install 组统一放宽。
  timeoutMs: 35 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/OpenHands/OpenHands.git",
      ref: "1.11.0",
      excludeDirs: ["docs", "frontend", "evaluation"],
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
    // frontend 已在 clone 时剪掉，这里再兜一层排除。
    const material = await agentSourceMaterial(t.sandbox, ["frontend"]);

    const DIMENSIONS: { key: string; threshold: number; criteria: string }[] = [
      {
        key: "传输保真",
        threshold: 0.7,
        criteria: `被测系统是「${CORE_USE_CASE}」，它对外的传输方式是：${TRANSPORT}。
判断：adapter（agent 手写的 send 实现）是否确实走 1.11.0 的 app_server /api/v1 协议——POST /api/v1/app-conversations
建会话拿 conversation_id、POST .../send-message 发任务、再通过轮询 GET events 或连 agent server 的原生 WebSocket
读 ActionEvent / ObservationEvent，映射成 niceeval 的事件流？
合格（Y）：能看到 POST /api/v1/app-conversations 建会话、send-message 发任务、并通过 events 轮询或原生 WebSocket 读取 action/observation 事件推进到结束。
不合格（N）：adapter 进程内直接 import 并调用 openhands 的函数；或在 adapter 里 spawn/启动 openhands 进程；或照旧版 Socket.IO oh_event/oh_user_action 写（1.11.0 已删除）；或根本没有对应的网络请求。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写——一个具体的、结果确定可核对的小编码任务？
不合格（N）：输入是 "hello" / "你好" / "test" / "帮我写点代码" 这类没有确定结果、无法核对的寒暄或占位内容。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了这个编码任务应得到的具体确定结果，而不是只判 agent 跑完？
合格（Y）：断言检查产出里出现那个确定结果（如斐波那契第 10 项 = 55，或某段代码的具体运行输出），用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「agent 结束了」「有产出」这类与具体结果无关的判定。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统是能自主干活的编码 agent，最核心的风险是：给它一个信息不足、无法完成的任务时，它会假装完成、编一个看似合理的结果。
判断：eval 是否包含一条针对这个负例的用例——给一个明显无法完成/信息不足的任务，断言 agent 明确表示无法完成/需要更多信息，而不是编造出一个已完成的结果？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 OpenHands 自主编码 agent，而不是各写各的、互不搭界？
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
      // 本段是「计量，不 gate」（见文件头）：计分制里 .points() 的得分点不参与判定，
      // 没挣到只是少挣分，不会让「文档没起作用」判负。五条接入路径这段写法一致。
      t.calledTool("shell", { input: { command: INDEX_RE } }).points(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).points(1); // 读到与宿主形态匹配的页面
      t.calledTool("shell", { input: { command: TIER_PAGE_RE } }).points(1); // 澄清里要摆的三档只有这页讲
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).points(1); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "openhands");

    turn.succeeded();
  },
});
