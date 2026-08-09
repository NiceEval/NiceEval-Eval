import { defineScoreEval } from "niceeval";
import { referencesAnyPath, toolMatch } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { saveAgentOutput } from "../install/share/agent-archive.ts";
import type { ClarifyFacts } from "../install/share/clarify-criteria.ts";
// 不调用 evalAdapter：起 Letta 服务重且不稳，断「真跑通」测到的是环境波动而不是文档效果
//（INIT.md 的完成清单仍要求真跑一次，agent 做不做由交互层/产出质量层如实计分）
import { evalExperiment } from "../install/share/eval-experiment.ts";
import { evalInstall, evalInteraction } from "../install/share/eval-install.ts";
import { agentSourceMaterial, cloneFixture } from "../install/share/fixture.ts";
import { evalAdapterPractice, evalExecutionEvidence } from "../install/share/eval-adapter.ts";
import { evalAuthoringPractice } from "../install/share/eval-authoring.ts";
import { buildQualityRubrics, type QualityFacts } from "../install/share/quality-criteria.ts";

/**
 * 接入路径：真实开源项目 Letta（前身 MemGPT，有状态记忆对话 agent）。
 *
 * 这条路径独有的维度是「多轮有状态」：agent 不是无状态问答，而是把说过的事实写进
 * 记忆块并跨轮复用。协议也因此有两跳——先 POST /v1/agents 建一个 agent 拿 agent_id，
 * 再 POST /v1/agents/{agent_id}/messages 发消息，且多轮必须复用同一个 agent_id，否则
 * 记忆无从谈起。响应不是 OpenAI 形状，而是 reasoning / tool_call / assistant 等分型
 * 消息组成的 JSON 列表，考的是「读懂被测系统自己的消息模型 + 维持会话状态」。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 把同一批页面在新旧版本里的两代路径
// 都编进这条正则（0.10.x 起 how-to/ 并入 tutorials/），同一份题库才能横跨新旧候选对比；候选里
// 不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/;

const CORE_USE_CASE =
  "一个有状态记忆的对话 agent（Letta / MemGPT）：第一轮告诉它「我叫韩梅梅、正在做一个叫 Orbit 的项目」，" +
  "agent 应把这些事实写进它的记忆块；后续轮问「我叫什么名字、在做什么项目」应准确复述之前说过的具体事实" +
  "（韩梅梅 / Orbit），而不是重新反问或答非所问；问一件从没告诉过它的私人信息（如「我住在哪个城市」）" +
  "应明确说不知道，而不是编一个具体城市名";

// 传输事实（按 Letta 0.16.8 实测源码填），喂澄清判据的【问接口】。adapter 写没写对不再用
// judge 读源码判——链路真通没通由 evalExecutionEvidence 机械取证（show --execution 有 ASSISTANT）。
const TRANSPORT =
  "两跳 HTTP（FastAPI，默认端口 8283）：先 POST /v1/agents 建一个 agent 拿 agent_id，再 POST " +
  "/v1/agents/{agent_id}/messages 发消息（非流式，另有 /messages/stream 才流式）；响应是 LettaResponse" +
  "——reasoning / tool_call / assistant 等分型消息的 JSON 列表，非 OpenAI 形状；多轮必须复用同一个 " +
  "agent_id 以维持记忆（同一 agent 禁并发、须串行）；鉴权默认不开，仅 LETTA_SERVER_SECURE=true / " +
  "--secure 时才校验 Authorization: Bearer LETTA_SERVER_PASSWORD";

// 项目专属事实，喂澄清判据；判据的机制部分见 ./share/clarify-criteria.ts。这几段是「事实」
// 不是「判据」——只描述 Letta 是什么样，不规定 agent 该说什么，judge 拿它做背景核对而非
// 要求逐字复述（otel 那条尤其：变量名是非标准的，不该要求 agent 背出来）。
// 产出质量事实（判据机制见 ./share/quality-criteria.ts）：合格证据形状按 Letta 0.16.8
// 实测协议填。CORE_USE_CASE 与上面同源——一份事实多处用。
const QUALITY: QualityFacts = {
  system: "Letta",
  coreUseCase: CORE_USE_CASE,
  useCaseShape: "一个具体的、先告诉 agent 某个事实、随后要它复述该事实的多轮记忆场景（复用同一 agent_id）",
  assertionPass:
    "能看到多轮交互（复用会话/agent 状态），且断言后续轮的回答里出现之前提供的那个具体事实" +
    "（如名字「韩梅梅」、项目名「Orbit」）",
  negativeRisk:
    "被测系统是有记忆的 agent，最核心的编造风险：问一件从没告诉过它的私人信息（如所在城市）时，" +
    "它会编一个看似合理的具体值而不是承认不知道。",
};

const CLARIFY: ClarifyFacts = {
  system: "Letta",
  transport: TRANSPORT,
  otel:
    "有原生 OpenTelemetry（letta/otel/，OTLP gRPC），默认关，且环境变量是非标准名 " +
    "LETTA_OTEL_EXPORTER_OTLP_ENDPOINT + LETTA_DISABLE_TRACING（不是业界标准的 OTEL_ 前缀）；另有 " +
    "Datadog / Sentry 均默认关。开箱即用的追踪只有「provider traces 写库（默认 True）」，经 " +
    "GET /v1/telemetry/{step_id} 读——对它是「设 OTLP 端点 / 读 provider traces / 自己补一层」",
  flags:
    "建 agent 时支持 model、embedding、agent_type（letta_v1_agent / memgpt_agent / memgpt_v2_agent 等）" +
    "作为变体",
};

export default defineScoreEval({
  description: "把 niceeval 接入 Letta（有状态记忆对话 agent / MemGPT）",
  // INIT.md 的完成清单含「真跑一次并 show 可见」，agent 大概率会尝试起被测系统，
  // 全局 20min 不够（canary.4 上 gpt-researcher 干到一半被掐死过），install 组统一放宽。
  timeoutMs: 35 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/letta-ai/letta.git",
      ref: "0.16.8",
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
    // Letta 是 Python 宿主，.ts 基本只有 agent 自己写的，不会混入宿主代码。
    const material = await agentSourceMaterial(t.sandbox);

    await t.group("产出质量层", async () => {
      // 纯加分：每维一条独立 closedQA，Y 挣 1 分、N 挣 0 分，不 gate——没挣到只是没提分。
      // 四维只判 eval 设计（adapter 链路由评估执行取证机械判，不进 judge）：机制与反模式从句
      // 住 ./share/quality-criteria.ts，事实由上面的 QUALITY 传入。
      for (const r of buildQualityRubrics(QUALITY)) {
        t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, { on: material }).points(1);
      }
    });

    // ── 第三层：评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；miss 时断言的 received 会带同名 shell 调用的出入参,归因不用手搓。
    await t.group("评估是否正确加载文档", async () => {
      // 本段是「计量，不 gate」（见文件头）：计分制里 t.score 的得分点不参与判定，
      // 没挣到只是少挣分，不会让「文档没起作用」判负。五条接入路径这段写法一致。
      t.score(
        "以随包 INDEX.md 为路由入口",
        t.calledTool(toolMatch("shell", { input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) })),
        { max: 1 },
      );
      t.score(
        "读到与宿主形态匹配的页面",
        t.calledTool(toolMatch("shell", {
          input: referencesAnyPath([
            "docs-site/zh/how-to/connect-your-agent.mdx",
            "docs-site/zh/how-to/write-send.mdx",
            "docs-site/zh/tutorials/connect-your-agent.mdx",
            "docs-site/zh/tutorials/write-send.mdx",
            "docs-site/zh/tutorials/quickstart.mdx",
          ]),
        })),
        { max: 1 },
      );
      t.score(
        "读到接入等级页",
        t.calledTool(toolMatch("shell", { input: referencesAnyPath(["docs-site/zh/explanation/tier.mdx"]) })),
        { max: 1 },
      );
      t.score(
        "没退回官网 / GitHub main",
        t.notCalledTool(toolMatch("shell", {
          input: referencesAnyPath([
            "niceeval.com/docs",
            "github.com/CorrectRoadH/niceeval/blob/main",
            "github.com/CorrectRoadH/niceeval/tree/main",
            "github.com/CorrectRoadH/niceeval/raw/main",
          ]),
        })),
        { max: 1 },
      );
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "letta");

    t.assert(turn.succeeded());
    return t.finishScore();
  },
});
