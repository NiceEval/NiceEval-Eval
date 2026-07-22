import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import { evalAdapter } from "./share/eval-adapter.ts";
import { evalExperiment } from "./share/eval-experiment.ts";
import { evalInstall } from "./share/eval-install.ts";
import { cloneFixture } from "./share/fixture.ts";

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

// closeQA 判据（DB-GPT 专属）：agent 动手前停下来问对没问对。接口形状与 otel 机制是逐项目
// 的事实，不能写成通用假设——下列 (1)(2) 按 DB-GPT v0.8.1 实测填：
//   接口：纯 HTTP+JSON、SSE 流式、无 WebSocket，默认 :5670；OpenAI 兼容入口是
//         `POST /api/v2/chat/completions`（Bearer 鉴权，标准 messages 形状），
//         前端主聊天另走私有形状的 `/api/v1/chat/completions`。
//   otel：DB-GPT 自带一套 tracer（默认只写本地 jsonl），并内置可选的标准 OTel/OTLP 导出，
//         默认关（需装 observability extra + TRACER_TO_OPEN_TELEMETRY=true）——所以「有没有
//         otel」对它不是有无题，而是「要不要复用它现成的 tracing / 打开 OTLP 导出」。
const CLARIFY_CRITERIA = `agent 在动手改代码前，先停下来回了用户一条消息做澄清，而不是直接开做。判断这条回复是否同时覆盖以下三个问题：
(1) 确认它要对接的接口 / 传输形状对不对——即它理解的 DB-GPT 入口（应是 OpenAI Chat Completions 兼容的 HTTP 端点，如 /api/v2/chat/completions，SSE 流式、非 WebSocket）是否正确，请用户核对；
(2) 问要不要接 / 复用 DB-GPT 的可观测性——DB-GPT 自带 tracer 且内置可选的 OpenTelemetry（OTLP）导出，问用户要不要把 niceeval 接到它现有的 tracing / otel 上；
(3) 问有没有 flag / 多 prompt 机制（同一被测系统要不要跑多组 prompt 对比）。
并且给出三个可选的接入档位让用户挑：① 简单接入（只写两个实验、不接 otel）② 复用 DB-GPT 的 tracing / 接 OTel ③ 支持 flag。
合格（Y）：三个问题都问到，且明确列出这三个可选档位。
不合格（N）：没停下来直接动手，或回复里没问这些、没给这三个选择。`;

export default defineScoreEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "v0.8.1",
      excludeDirs: ["docs", "assets"],
    });

    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 通用检查：评估安装（gate + 软分混合）+ 评估exp质量（软分）+ 评估adapter（软分）。 ──
    // ── 四条接入路径共用同一套判定。 ──
    await evalInstall(t, { version, clarifyCriteria: CLARIFY_CRITERIA });
    await evalExperiment(t);
    await evalAdapter(t);

    // ── 宿主专属·评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；miss 时断言的 received 会带同名 shell 调用的出入参,归因不用手搓。
    await t.group("评估是否正确加载文档", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1); // 读到与宿主形态匹配的页面
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    // 沙箱马上就销毁，产物随之消失——趁现在抓一份。纯落盘，不影响 verdict。
    await saveAgentOutput(t, "db-gpt");

    turn.succeeded();
  },
});
