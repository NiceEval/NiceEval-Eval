import { defineEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import { runGenericChecks } from "./share/checks-generic.ts";
import {
  assertAdapterRanLive,
  type QualityDimension,
  runQualityDimensions,
} from "./share/checks-quality.ts";
import { cloneFixture } from "./share/fixture.ts";

/**
 * 接入路径：真实开源项目 GPT Researcher（自动化研究报告 agent）。
 *
 * 协议是自研的 WebSocket JSON 帧（/ws）：发一帧起一次研究任务，服务端陆续推
 * logs / report 等私有事件帧，直到任务完成。没有任何内置件能直接对上，agent
 * 必须手写 send 并把这些私有帧映射成标准事件流——这是四个 fixture 里唯一
 * 保留「手写流式协议映射」这条最长路径的一个。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 把同一批页面在新旧版本里的
// 两代路径都编进这条正则（0.10.x 起 how-to/ 并入 tutorials/），同一份题库才能横跨新旧
// 候选对比；候选里不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(write-send|connect-your-agent)\.mdx|docs-site\/zh\/reference\/events\.mdx/;

const CORE_USE_CASE =
  "一个自动化研究报告 agent（GPT Researcher）：给定一个研究主题（如「2026 年固态电池行业进展」）" +
  "应该生成一份带小标题结构的报告，且至少引用一条真实来源链接；不应该在没有任何检索结果时" +
  "仍然编出一份看似完整的报告";

const TRANSPORT = "WebSocket /ws（自研 JSON 帧协议：发起研究任务，陆续收 logs / report 等私有事件帧）";

export default defineEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
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

    // ── 通用检查：安装链（gate）+ 通用品味（软分）。四条接入路径共用同一套判定。 ──
    await runGenericChecks(t, { version });

    // ── 通用检查·能动性层（软分，不 gate）。adapter 真能把一条 GPT Researcher 回应拉回来吗。 ──
    // 读 agent 内层真跑落盘的 events，独立判有没有实质回应；实现见 lib/checks-quality.ts。
    await assertAdapterRanLive(t);

    // ── 宿主专属·产出质量层（judge 软分）。按维度分别判 agent 写出的三件套质量。 ──
    // 判据材料（三件套源码、必须含 adapter）由 runQualityDimensions 内部经 openProject
    // 取得，契约见 lib/checks-quality.ts 头注。
    // 跟 db-gpt 一样，把一条二值 closedQA 拆成多条各自可证伪的分维度 judge。GPT Researcher
    // 这条路径特殊在传输是「自研 WebSocket 帧协议」，但 agent 也可能选等价的 REST 端点
    // （实测见过 POST /report/）——所以传输维度按「有没有真走 GPT Researcher 服务的网络接口
    // 并映射成事件流」判，不钉死 WebSocket 还是 HTTP。
    const DIMENSIONS: QualityDimension[] = [
      {
        key: "传输保真",
        threshold: 0.7,
        criteria: `被测系统 GPT Researcher 是一个独立运行的服务，agent 必须通过网络与它通信。它的代表性接入方式是：${TRANSPORT}；但 agent 也可能选用等价的 HTTP 端点（如 REST POST /report/）——判据是「有没有真的走 GPT Researcher 服务的网络接口，并把响应/帧映射成 niceeval 的事件流」，不是「用 WebSocket 还是 HTTP、哪个具体路径」。
判断：adapter（agent 手写的 send 实现）是否确实通过网络与 GPT Researcher 服务通信并产出文本/事件？
合格（Y）：能看到向 GPT Researcher 服务建 WebSocket /ws 发帧并解析陆续推来的私有事件帧（logs/report…），或向其某个 HTTP 端点（如 /report/）发请求并解析响应；把结果映射成 niceeval 的 message/事件。
不合格（N）：adapter 进程内直接 import 并调用被测系统的 Python/函数；或在 adapter 里 spawn/启动被测系统进程；或根本没有对 GPT Researcher 服务的网络通信。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实用例写（一个具体的研究主题，要求生成研究报告）？
不合格（N）：输入是 "hello" / "你好" / "test" 这类与研究任务无关的寒暄或占位内容；或是「GPT Researcher 是什么 / 它有什么优点」这类**让被测系统研究它自己的自指元问题**——那不是用户拿它做研究的用例，且断言极易靠复读题目通过（v0.9.1 实测放过了一次，这条要判 N）。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了这份研究报告应有的具体结果，而不是只判跑通？
合格（Y）：断言检查报告的实质内容——如带小标题/结构、至少引用一条真实来源链接、包含与主题相关的具体信息——用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「回复长度>0」「有回复」这类与内容无关的判定；或断言是**重言式**——断言的关键词在 t.send() 输入里本来就出现过（如输入含 "RAG" 再断言回复含 /RAG/、输入含 "GPT Researcher" 再断言回复含它），被测方复读题目即可通过，判 N。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统是检索型 agent，最核心的风险是：在没有任何检索结果 / 找不到可靠来源时，它仍然编出一份看似完整、带引用的报告。
判断：eval 是否包含一条针对这个负例的用例——在检索不到来源的情形下，断言被测方不产出编造的完整报告（或明确说明检索不到 / 无可用来源）？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 GPT Researcher（自动化研究报告 agent），而不是各写各的、互不搭界？
不合格（N）：experiment 用的是 echoAgent / 通用占位 agent，或引用的 agent 与 eval 的被测系统看不出关联。`,
      },
    ];

    await runQualityDimensions(t, DIMENSIONS);

    // ── 宿主专属·路由层（计量，不 gate）。文档到底起没起作用。 ──────────
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；calledTool 的 RegExp 只测 input 侧，各种读法都接得住。miss 时想看
    // 「实际读了哪几页」拿不到——那是 calledTool 的 arg 缺口，已记去反馈 niceeval，不再手搓解析。
    await t.group("路由层", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1); // 读到与宿主形态匹配的页面
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    await saveAgentOutput(t, "gpt-researcher");

    turn.succeeded();
  },
});
