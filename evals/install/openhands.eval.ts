import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
// 不调用 evalAdapter：任务描述没要求 agent 真跑一次（起 OpenHands 服务 + Socket.IO runtime 重且不稳），evalAdapter 断的正是那件事
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

const TRANSPORT =
  "OpenHands 1.11.0 的新 app_server（FastAPI，/api/v1，默认端口 3000）：先 POST /api/v1/app-conversations " +
  "建会话拿 conversation_id，再 POST /api/v1/app-conversations/{id}/send-message 发任务；读结果要么轮询宿主侧 " +
  "GET /conversation/{id}/events，要么连进 sandbox 内 agent server 的原生 WebSocket /sockets/events/{id}" +
  "（承载 SDK 的 ActionEvent / ObservationEvent），映射成 niceeval 事件流直到 agent 结束（app_server 是薄代理、" +
  "agent 实跑在 sandbox 内 agent server；旧版 Socket.IO oh_event/oh_user_action 已删除，别用）";

// closeQA 判据（OpenHands 专属）：agent 动手前停下来问对没问对。接口形状与 otel 机制是逐项目
// 的事实，不能写成通用假设——下列按 OpenHands 1.11.0 实测源码填（注意 1.11.0 已整体改写，旧的
// /api/conversations + Socket.IO oh_event/oh_user_action 后端已删除）：
//   接口：新 app_server（FastAPI，/api/v1，默认端口 3000）。POST /api/v1/app-conversations 建会话拿
//         conversation_id；POST /api/v1/app-conversations/{id}/send-message 发任务；读事件要么轮询宿主侧
//         GET /conversation/{id}/events（无 SSE/WS），要么连进 sandbox 内 agent server 的原生 WebSocket
//         /sockets/events/{id}?session_api_key=（承载 SDK 的 ActionEvent / ObservationEvent）。app_server 是
//         薄代理，agent 实跑在 sandbox 内独立 agent server（openhands-agent-server 包）。非 OpenAI 形状。
//   otel：无内置 OTLP 接线——opentelemetry 只是没用上的 pin 依赖，宿主没有 OTEL_ 开关、不产 trace。
//         唯一内置遥测是 PostHog，且后端事件仅企业版开、OSS 默认只有前端匿名上报（POSTHOG_CLIENT_KEY +
//         user_consents_to_analytics 设置）；无 Sentry / Langfuse。可观测性实际只有结构化日志（LOG_JSON）。
//         所以「有没有 otel」对它是「没有现成 otel，要不要自己补一层 tracing」。
const CLARIFY_CRITERIA = `agent 在动手改代码前，先停下来回了用户一条消息做澄清，而不是直接开做。判断这条回复是否同时覆盖以下三个问题：
(1) 确认它要对接的接口 / 传输形状对不对——即它理解的 OpenHands 入口（1.11.0 应是新 app_server /api/v1：POST /api/v1/app-conversations 建会话、POST .../send-message 发任务、再轮询 GET events 或连 agent server 的原生 WebSocket 读 ActionEvent/ObservationEvent；app_server 是薄代理、agent 实跑在 sandbox 内 agent server；不是旧版 /api/conversations + Socket.IO oh_event/oh_user_action）是否正确，请用户核对；
(2) 问要不要接 / 复用它的可观测性——OpenHands 没有现成的 OpenTelemetry 接线（opentelemetry 只是没用上的依赖），唯一内置遥测是 PostHog（后端仅企业版、OSS 只前端匿名），可观测性实际只有结构化日志，问用户要不要自己给 niceeval 补一层 tracing；
(3) 问有没有 flag / 多 prompt 机制——OpenHands 建会话支持 agent_type（default / plan）、llm_model、agent_profile_id、max_iterations、max_budget_per_task 等作为变体，问用户要不要把这些暴露成 experiment flags 跑对比。
并且按 niceeval 的接入等级（Tier）摆出三档让用户挑（档位讲的是「adapter 接到多深」，与写几个实验无关）：
① Tier 1（只接 send）——不改 OpenHands，只写 adapter 走 app_server /api/v1 建会话 + 发任务 + 读事件、映射成 niceeval 事件流，先跑通基线；
② Tier 2（send + OTel）——OpenHands 无现成 OTel，这一档要自己给它补一层 tracing 并把 span 发给 niceeval 看调用瀑布图；
③ Tier 3（侵入 + flags）——把 agent_type / llm_model / max_iterations 等变体暴露成 experiment flags，做 agent 类型 / 模型的 A/B 对比。
合格（Y）：三个问题都问到，且明确摆出这三档接入等级让用户选。
不合格（N）：没停下来直接动手，或回复里没问这些、没给这三档选择。`;

export default defineScoreEval({
  description: "把 niceeval 接入 OpenHands（自主编码 agent）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/OpenHands/OpenHands.git",
      ref: "1.11.0",
      excludeDirs: ["docs", "frontend", "evaluation"],
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
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).points(1); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "openhands");

    turn.succeeded();
  },
});
