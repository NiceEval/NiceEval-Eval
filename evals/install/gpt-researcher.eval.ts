import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
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

// closeQA 判据（GPT Researcher 专属）：agent 动手前停下来问对没问对。接口形状与 otel 机制是逐项目
// 的事实，不能写成通用假设——下列按 GPT Researcher v3.6.0 实测源码填：
//   接口：自研 WebSocket /ws（FastAPI，默认 0.0.0.0:8000，端点在 backend/server/app.py，非 server.py）。
//         连上后发文本命令 "start " 后跟一段 JSON（json.loads(data[6:])，字段含 task/report_type/
//         tone/report_source 等）起一次研究；服务端陆续 send_json 推 type=logs（过程，多条）/ images
//         （可选）/ report（正文分段，多条，仅 {type,output}）帧，最后一帧 {"type":"path"} 表示完成
//         （v3.6.0 服务端不发 report_complete，那个 type 只在前端）。虽也有 REST（/api/chat 要 report
//         字段、/report/ 收 task/report_type…）但都非 OpenAI Chat Completions 形状。
//   otel：无 OpenTelemetry（全仓 0 命中）。可观测性只有 LangChain LangSmith（LANGCHAIN_TRACING_V2 /
//         LANGCHAIN_API_KEY 等）；服务端 get_config_dict 把 TRACING_V2 兜底成 "true"，但缺省无 API key
//         故不实际上报——所以「有没有 otel」对它是「要不要补一层 tracing / 提供 key 打开 LangSmith」。
const CLARIFY_CRITERIA = `agent 在动手改代码前，先停下来回了用户一条消息做澄清，而不是直接开做。判断这条回复是否同时覆盖以下三个问题：
(1) 确认它要对接的接口 / 传输形状对不对——即它理解的 GPT Researcher 入口（应是自研 WebSocket /ws：连上后发文本命令 "start " 跟一段 JSON 起一次研究，服务端陆续推 type 为 logs / images / report 的 JSON 帧，最后一帧 {"type":"path"} 表示完成；非 OpenAI Chat Completions 形状，也不是普通 REST 请求-响应）是否正确，请用户核对；
(2) 问要不要接 / 复用它的可观测性——GPT Researcher 没有 OpenTelemetry，只有 LangChain 的 LangSmith 追踪（靠 LANGCHAIN_TRACING_V2 / LANGCHAIN_API_KEY 等环境变量；服务端把 TRACING_V2 兜底成 true，但缺省无 API key 故不实际上报），问用户要不要把 niceeval 接到它的 tracing 上、或提供 key 打开 LangSmith；
(3) 问有没有 flag / 多 prompt 机制——GPT Researcher 的 start 帧支持 report_type（research_report / detailed_report / deep 等）、tone、report_source 等参数作为研究变体，问用户要不要把这些暴露成 experiment flags 跑多组对比。
并且按 niceeval 的接入等级（Tier）摆出三档让用户挑（档位讲的是「adapter 接到多深」，与写几个实验无关）：
① Tier 1（只接 send）——不改 GPT Researcher，只写 adapter 手写这套 WebSocket /ws 帧映射（发 start、把 logs / report / path 帧映射成 niceeval 事件流、以 path 帧作结束），先跑通基线；
② Tier 2（send + OTel）——GPT Researcher 无原生 OTel，这一档要给它补一层 tracing（或复用现成的 LangSmith）并把 span 也发给 niceeval 看调用瀑布图；
③ Tier 3（侵入 + flags）——把 report_type / tone 等变体暴露成 experiment flags，做研究类型 / 语气的 A/B 对比。
合格（Y）：三个问题都问到，且明确摆出这三档接入等级让用户选。
不合格（N）：没停下来直接动手，或回复里没问这些、没给这三档选择。`;

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
        `integration yourself — adapter, eval, and experiment. Nobody is available to confirm decisions with.\n\n` +
        `Then actually run your eval once, end to end — bring up whatever the integration needs so a real ` +
        `request reaches the system under test and a real response comes back — and confirm the result is ` +
        `viewable with \`niceeval show\`. A wired-up adapter that has never actually run once is not done.\n\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 通用检查：评估安装（gate + 软分混合）+ 评估exp质量（软分）+ 评估adapter（软分）。 ──
    // ── 五条接入路径共用同一套判定。 ──
    await evalInstall(t, { version, clarifyCriteria: CLARIFY_CRITERIA, turn });
    await evalExperiment(t);
    await evalAdapter(t);

    // ── 宿主专属·评估是否正确加载文档（计量，不 gate）。文档到底起没起作用。 ──────
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
    await saveAgentOutput(t, "gpt-researcher");

    turn.succeeded();
  },
});
