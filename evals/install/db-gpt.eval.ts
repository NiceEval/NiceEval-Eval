import { defineScoreEval } from "niceeval";
import { referencesAnyPath, toolMatch } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import type { ClarifyFacts } from "./share/clarify-criteria.ts";
import { evalAdapter, evalAdapterPractice, evalExecutionEvidence } from "./share/eval-adapter.ts";
import { evalAuthoringPractice } from "./share/eval-authoring.ts";
import { evalExperiment } from "./share/eval-experiment.ts";
import { evalInstall, evalInteraction } from "./share/eval-install.ts";
import { agentSourceMaterial, cloneFixture } from "./share/fixture.ts";
import { buildQualityRubrics, type QualityFacts } from "./share/quality-criteria.ts";

/**
 * 接入路径：真实开源项目 DB-GPT（数据库对话式分析 + AWEL 工作流平台）。
 *
 * 仓库体积很大（完整 clone 接近 700MB，`docs/` 与 `assets/` 两个目录占了大头且与
 * 「装 niceeval」无关），所以用 sparse-checkout 剪掉。协议是
 * OpenAI Chat Completions 兼容形状（/v2/chat/completions），但 niceeval 没有对应内置件——
 * 兼容标准形状不等于零映射，仍然要手写 send。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 把同一批页面在新旧版本里的
// 两代路径都编进这条正则（0.10.x 起 how-to/ 并入 tutorials/），同一份题库才能横跨新旧
// 候选对比；候选里不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/;

// 传输事实（按 DB-GPT v0.8.1 实测源码填），喂澄清判据的【问接口】。adapter 写没写对不用
// judge 读源码判——链路真通没通由 evalExecutionEvidence 机械取证（show --execution 有 ASSISTANT）。
const TRANSPORT =
  "纯 HTTP + JSON、SSE 流式、无 WebSocket，默认端口 5670；OpenAI Chat Completions 兼容入口是 " +
  "POST /api/v2/chat/completions（Bearer 鉴权，标准 messages 形状），前端主聊天另走私有形状的 " +
  "/api/v1/chat/completions";

// 产出质量事实（判据机制见 ./share/quality-criteria.ts）。旁路从句来自 .agent-output/ 实跑取证：
// 历史产物无一例外用 chat_normal 问算术/常识，测到的是挂载的底层 LLM，DB-GPT 的数据库能力
// 完全没被碰到。
const QUALITY: QualityFacts = {
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
};

// 项目专属事实（按 DB-GPT v0.8.1 实测源码填），喂澄清判据；判据的机制部分见
// ./share/clarify-criteria.ts。这三段是「事实」不是「判据」——只描述 DB-GPT 是什么样，
// 不规定 agent 该说什么，judge 拿它做背景核对而非要求逐字复述。
const CLARIFY: ClarifyFacts = {
  system: "DB-GPT",
  transport: TRANSPORT,
  otel:
    "DB-GPT 自带一套 tracer（默认只写本地 jsonl），并内置可选的标准 OTel / OTLP 导出，默认关" +
    "（需装 observability extra + TRACER_TO_OPEN_TELEMETRY=true）——所以对它不是「有没有 otel」" +
    "的有无题，而是「要不要复用它现成的 tracing / 打开 OTLP 导出」",
  flags:
    "/api/v2/chat/completions 的请求体支持 model（挂载的 LLM）、chat_mode（chat_normal / chat_app / chat_knowledge / " +
    "chat_data / chat_db_qa / chat_dashboard / chat_awel_flow 等对话模式，非 normal 模式还要配套的 chat_param 指定" +
    "具体的库 / 知识库 / 应用）、temperature、max_new_tokens、stream 等参数作为变体",
};

export default defineScoreEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  judge: true,
  // INIT.md 的完成清单含「真跑一次并 show 可见」，装+读文档+写三件套+端到端一轮下来
  // 全局 20min 不够（canary.4 上 gpt-researcher 干到一半被掐死过），install 组统一放宽。
  timeoutMs: 35 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "v0.8.1",
      excludeDirs: ["docs", "assets"],
    });

    // send 是「用户会原样复制的那句话」：只有读引导 + 装包 + 版本钉死。写三件套、真跑一次、
    // show 可见这些行为要求全部住在 INIT.md 的 TODO 清单里——agent 做没做到是文档的读数，
    // 不由 prompt 代劳。五条接入路径同一份文案。
    const prompt =
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`;
    const turn = await t.send(prompt);

    // ── 通用检查：评估安装（gate + 软分混合）+ 评估exp质量（软分）+ 评估adapter（软分）
    // ── + 评估执行取证（加分）+ 最佳实践两层（纯加分：adapter 的 send 写法、eval 的断言写法，
    // ── 判据逐条来自候选自己发的文档）。五条接入路径共用同一套判定（评估adapter 仅两条轻路径调）。 ──
    await evalInteraction(t, {
      clarify: CLARIFY,
      createEval: { quality: QUALITY, comparisonOptions: CLARIFY.flags },
      turn,
    });
    await evalInstall(t, { version, standaloneWorkspace: true });
    await evalExperiment(t);
    await evalAdapter(t);
    await evalExecutionEvidence(t);
    await evalAdapterPractice(t);
    await evalAuthoringPractice(t);

    // ── 产出质量层（纯加分）：judge 读 agent 手写的 .ts 源码按维度判 eval 设计质量。 ──
    const material = await agentSourceMaterial(t.sandbox);
    const qualityMaterial = { input: prompt, output: material };

    await t.group("产出质量层", async () => {
      // 纯加分：每维一条独立 closedQA，Y 挣 1 分、N 挣 0 分，不 gate——没挣到只是没提分。
      // 四维只判 eval 设计（adapter 链路由评估adapter/评估执行取证机械判，不进 judge）：
      // 机制与反模式从句住 ./share/quality-criteria.ts，事实由上面的 QUALITY 传入。
      for (const r of buildQualityRubrics(QUALITY)) {
        t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, qualityMaterial).score(1);
      }
    });

    // ── 宿主专属·评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；miss 时断言的 received 会带同名 shell 调用的出入参,归因不用手搓。
    await t.group("评估是否正确加载文档", async () => {
      // 本段是「计量，不 gate」（见文件头）：计分制里 t.score 的得分点不参与判定，
      // 没挣到只是少挣分，不会让「文档没起作用」判负。五条接入路径这段写法一致。
      t.calledTool(
        toolMatch("shell", { input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
      ).label("以随包 INDEX.md 为路由入口").score(1);
      t.calledTool(toolMatch("shell", {
        input: referencesAnyPath([
          "docs-site/zh/how-to/connect-your-agent.mdx",
          "docs-site/zh/how-to/write-send.mdx",
          "docs-site/zh/tutorials/connect-your-agent.mdx",
          "docs-site/zh/tutorials/write-send.mdx",
          "docs-site/zh/tutorials/quickstart.mdx",
        ]),
      })).label("读到与宿主形态匹配的页面").score(1);
      t.calledTool(
        toolMatch("shell", { input: referencesAnyPath(["docs-site/zh/explanation/tier.mdx"]) }),
      ).label("读到接入等级页").score(1);
      t.notCalledTool(
        toolMatch("shell", {
          input: referencesAnyPath([
            "niceeval.com/docs",
            "github.com/CorrectRoadH/niceeval/blob/main",
            "github.com/CorrectRoadH/niceeval/tree/main",
            "github.com/CorrectRoadH/niceeval/raw/main",
          ]),
        }),
      ).label("没退回官网 / GitHub main").score(1);
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    // 沙箱马上就销毁，产物随之消失——趁现在抓一份。纯落盘，不影响 verdict。
    await saveAgentOutput(t, "db-gpt");

    turn.succeeded().gate();
  },
});
