import { defineScoreEval } from "niceeval";
import { referencesAnyPath, toolMatch } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { saveAgentOutput } from "../install/share/agent-archive.ts";
import type { ClarifyFacts } from "../install/share/clarify-criteria.ts";
// 不调用 evalAdapter：起 OpenHands app_server + sandbox 内 agent server 重且不稳，断「真跑通」测到的是
// 环境波动而不是文档效果（INIT.md 的完成清单仍要求真跑一次，agent 做不做由交互层/产出质量层如实计分）
import { evalExperiment } from "../install/share/eval-experiment.ts";
import { evalInstall, evalInteraction } from "../install/share/eval-install.ts";
import { agentSourceMaterial, cloneFixture } from "../install/share/fixture.ts";
import { evalAdapterPractice, evalExecutionEvidence } from "../install/share/eval-adapter.ts";
import { evalAuthoringPractice } from "../install/share/eval-authoring.ts";
import { buildQualityRubrics, type QualityFacts } from "../install/share/quality-criteria.ts";

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
// Socket.IO oh_event/oh_user_action 后端已删除），喂澄清判据的【问接口】。adapter 写没写对不再用
// judge 读源码判——链路真通没通由 evalExecutionEvidence 机械取证（show --execution 有 ASSISTANT）。
const TRANSPORT =
  "OpenHands 1.11.0 的新 app_server（FastAPI，/api/v1，默认端口 3000）：先 POST /api/v1/app-conversations " +
  "建会话拿 conversation_id，再 POST /api/v1/app-conversations/{id}/send-message 发任务；读结果要么轮询宿主侧 " +
  "GET /conversation/{id}/events（无 SSE / WS），要么连进 sandbox 内 agent server 的原生 WebSocket " +
  "/sockets/events/{id}?session_api_key=（承载 SDK 的 ActionEvent / ObservationEvent），映射成 niceeval 事件流" +
  "直到 agent 结束（app_server 是薄代理、agent 实跑在 sandbox 内独立的 agent server / openhands-agent-server 包；" +
  "非 OpenAI 形状；旧版 Socket.IO oh_event/oh_user_action 已删除，别用）";

// 产出质量事实（判据机制见 ./share/quality-criteria.ts）：合格证据形状按 OpenHands 1.11.0
// 实测协议填。CORE_USE_CASE 与上面同源——一份事实多处用。
const QUALITY: QualityFacts = {
  system: "OpenHands",
  coreUseCase: CORE_USE_CASE,
  useCaseShape: "一个具体的、结果确定可核对的小编码任务",
  assertionPass: "断言检查产出里出现那个确定结果（如斐波那契第 10 项 = 55，或某段代码的具体运行输出）",
  negativeRisk:
    "被测系统是能自主干活的编码 agent，最核心的编造风险：给它一个信息不足、无法完成的任务时，" +
    "它会假装完成、编一个看似合理的结果。",
};

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
  judge: true,
  // INIT.md 的完成清单含「真跑一次并 show 可见」，agent 大概率会尝试起被测系统，
  // 全局 20min 不够（canary.4 上 gpt-researcher 干到一半被掐死过），install 组统一放宽。
  timeoutMs: 35 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");

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

    // ── 通用检查：评估安装（gate + 软分混合）+ 评估exp质量（软分）+ 评估执行取证（加分）
    // ── + 最佳实践两层（纯加分：adapter 的 send 写法、eval 的断言写法，判据逐条来自候选
    // ── 自己发的文档）。五条接入路径共用同一套判定。 ──
    await evalInteraction(t, { clarify: CLARIFY, turn });
    await evalInstall(t, { version, standaloneWorkspace: true });
    await evalExperiment(t);
    await evalExecutionEvidence(t);
    await evalAdapterPractice(t);
    await evalAuthoringPractice(t);

    // ── 第二层：产出质量层（judge）。按维度分别判 agent 写出的三件套质量。 ──
    // 一条 find+cat 命令把 agent 手写的 .ts 带路径头串成材料（含 adapter）——「传输方式
    // 对不对」只在 adapter 里看得见；judge 按路径头自行区分 experiment / eval / adapter。
    // frontend 已在 clone 时剪掉，这里再兜一层排除。
    const material = await agentSourceMaterial(t.sandbox, ["frontend"]);

    await t.group("产出质量层", async () => {
      // 纯加分：每维一条独立 closedQA，Y 挣 1 分、N 挣 0 分，不 gate——没挣到只是没提分。
      // 四维只判 eval 设计（adapter 链路由评估执行取证机械判，不进 judge）：机制与反模式从句
      // 住 ./share/quality-criteria.ts，事实由上面的 QUALITY 传入。
      for (const r of buildQualityRubrics(QUALITY)) {
        t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, {
          input: "下面是待按给定判据评审的 agent 产出。",
          output: material,
        }).score(1);
      }
    });

    // ── 第三层：评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；miss 时断言的 received 会带同名 shell 调用的出入参,归因不用手搓。
    await t.group("评估是否正确加载文档", async () => {
      // 本段是「计量，不 gate」（见文件头）：计分制里 Assertion 的 .score(1) 不参与判定，
      // 没挣到只是少挣分，不会让「文档没起作用」判负。五条接入路径这段写法一致。
      t.calledTool(
        toolMatch("shell", { input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
      ).label("以随包 INDEX.md 为路由入口").score(1);
      t.calledTool(toolMatch("shell", {
        input: referencesAnyPath([
          "docs-site/zh/how-to/write-send.mdx",
          "docs-site/zh/how-to/connect-your-agent.mdx",
          "docs-site/zh/tutorials/write-send.mdx",
          "docs-site/zh/tutorials/connect-your-agent.mdx",
          "docs-site/zh/reference/events.mdx",
        ]),
      })).label("读到与宿主形态匹配的页面").score(1);
      t.calledTool(
        toolMatch("shell", { input: referencesAnyPath(["docs-site/zh/explanation/tier.mdx"]) }),
      ).label("读到接入等级页").score(1);
      t.notCalledTool(toolMatch("shell", {
        input: referencesAnyPath([
          "niceeval.com/docs",
          "github.com/CorrectRoadH/niceeval/blob/main",
          "github.com/CorrectRoadH/niceeval/tree/main",
          "github.com/CorrectRoadH/niceeval/raw/main",
        ]),
      })).label("没退回官网 / GitHub main").score(1);
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "openhands");

    turn.succeeded().gate();
  },
});
