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
 * 接入路径：真实开源项目 GPT Researcher（自动化研究报告 agent）。
 *
 * 协议是自研的 WebSocket 帧（/ws）：发一条 "start " 文本命令 + JSON 起一次研究任务，
 * 服务端陆续推 logs / report 等私有事件帧，最后一帧 {"type":"path"} 收尾。没有任何内置件
 * 能直接对上，agent 必须手写 send 并把这些私有帧映射成标准事件流——这是接入路径里
 * 保留「手写流式协议映射」这条最长路径的一个。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 把同一批页面在新旧版本里的
// 两代路径都编进这条正则（0.10.x 起 how-to/ 并入 tutorials/），同一份题库才能横跨新旧
// 候选对比；候选里不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(write-send|connect-your-agent)\.mdx|docs-site\/zh\/reference\/events\.mdx/;

// 项目专属事实（按 GPT Researcher v3.6.0 实测源码填），喂澄清判据；判据的机制部分见
// ./share/clarify-criteria.ts。这三段是「事实」不是「判据」——只描述这个系统是什么样，
// 不规定 agent 该说什么，judge 拿它做背景核对而非要求逐字复述。
const CLARIFY: ClarifyFacts = {
  system: "GPT Researcher",
  transport:
    "自研 WebSocket /ws（FastAPI，默认 0.0.0.0:8000，端点在 backend/server/app.py 而非 server.py）：连上后发" +
    "文本命令 \"start \" 后跟一段 JSON（json.loads(data[6:])，字段含 task / report_type / tone / report_source 等）" +
    "起一次研究；服务端陆续 send_json 推 type=logs（过程，多条）/ images（可选）/ report（正文分段，多条，" +
    "仅 {type,output}）帧，最后一帧 {\"type\":\"path\"} 表示完成（v3.6.0 服务端不发 report_complete，那个 type " +
    "只在前端）。虽然也有 REST（/api/chat 要 report 字段、/report/ 收 task/report_type…）但都不是 OpenAI " +
    "Chat Completions 形状，主路径也不是普通的 REST 请求-响应",
  otel:
    "无 OpenTelemetry（全仓 0 命中）。可观测性只有 LangChain 的 LangSmith（LANGCHAIN_TRACING_V2 / " +
    "LANGCHAIN_API_KEY 等环境变量）；服务端 get_config_dict 把 TRACING_V2 兜底成 \"true\"，但缺省没有 API key " +
    "所以不实际上报——对它是「要不要自己补一层 tracing / 提供 key 打开 LangSmith」",
  flags:
    "start 帧的 JSON 支持 report_type（research_report / detailed_report / deep 等）、tone、report_source " +
    "等参数作为研究变体",
};

export default defineScoreEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/assafelovic/gpt-researcher.git",
      ref: "v3.6.0",
    });

    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo, then finish the ` +
        `integration — adapter, eval, and experiment.\n\n` +
        `Then actually run your eval once, end to end — bring up whatever the integration needs so a real ` +
        `request reaches the system under test and a real response comes back — and confirm the result is ` +
        `viewable with \`niceeval show\`. A wired-up adapter that has never actually run once is not done.\n\n` +
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
    await saveAgentOutput(t, "gpt-researcher");

    turn.succeeded();
  },
});
