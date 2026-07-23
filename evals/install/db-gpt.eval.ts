import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE, TIER_PAGE_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import type { ClarifyFacts } from "./share/clarify-criteria.ts";
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

// 项目专属事实（按 DB-GPT v0.8.1 实测源码填），喂澄清判据；判据的机制部分见
// ./share/clarify-criteria.ts。这三段是「事实」不是「判据」——只描述 DB-GPT 是什么样，
// 不规定 agent 该说什么，judge 拿它做背景核对而非要求逐字复述。
const CLARIFY: ClarifyFacts = {
  system: "DB-GPT",
  transport:
    "纯 HTTP + JSON、SSE 流式、无 WebSocket，默认端口 5670；OpenAI Chat Completions 兼容入口是 " +
    "POST /api/v2/chat/completions（Bearer 鉴权，标准 messages 形状），前端主聊天另走私有形状的 " +
    "/api/v1/chat/completions",
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
    // ── 五条接入路径共用同一套判定。 ──
    await evalInstall(t, { version, clarify: CLARIFY, turn });
    await evalExperiment(t);
    await evalAdapter(t);

    // ── 宿主专属·评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
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
    // 沙箱马上就销毁，产物随之消失——趁现在抓一份。纯落盘，不影响 verdict。
    await saveAgentOutput(t, "db-gpt");

    turn.succeeded();
  },
});
