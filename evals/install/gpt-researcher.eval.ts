import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
import { SANDBOX_INIT_DOC_PATH, assertPagesInCandidate } from "../../lib/candidate.ts";
import { assertNiceevalInstalled } from "../../lib/mechanism.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 GPT Researcher（自动化研究报告 agent）。
 *
 * 协议是自研的 WebSocket JSON 帧（/ws）：发一帧起一次研究任务，服务端陆续推
 * logs / report 等私有事件帧，直到任务完成。没有任何内置件能直接对上，agent
 * 必须手写 send 并把这些私有帧映射成标准事件流——这是四个 fixture 里唯一
 * 保留「手写流式协议映射」这条最长路径的一个。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/reference/events.mdx",
];

const CORE_USE_CASE =
  "一个自动化研究报告 agent（GPT Researcher）：给定一个研究主题（如「2026 年固态电池行业进展」）" +
  "应该生成一份带小标题结构的报告，且至少引用一条真实来源链接；不应该在没有任何检索结果时" +
  "仍然编出一份看似完整的报告";

const TRANSPORT = "WebSocket /ws（自研 JSON 帧协议：发起研究任务，陆续收 logs / report 等私有事件帧）";

export default defineEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/assafelovic/gpt-researcher.git",
      ref: "v3.6.0",
    });

    const turn = await t.send(
      `READ ${SANDBOX_INIT_DOC_PATH} and install niceeval for this repo.\n\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 第一层：检查 niceeval 是否安装好（gate）。四条接入路径共用同一套判定。 ──
    await assertNiceevalInstalled(t, { version });

    // ── 第二层：产出质量层（judge）。experiment 与 eval 是否真的关联到这个被测系统。 ──
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      // GPT Researcher 自带一个 frontend 目录；排除掉避免和 agent 写的 adapter 混在一起
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "frontend"],
    });
    const experimentSource = src
      .filter((f) => /^experiments\//.test(f.path))
      .map((f) => f.content)
      .join("\n\n");
    const evalSource = src
      .filter((f) => /\.eval\.ts$/.test(f.path))
      .map((f) => f.content)
      .join("\n\n");

    await t.group("产出质量层", async () => {
      // GPT Researcher 走的是自研 WebSocket 帧协议，不是普通 HTTP 请求/响应——
      // 判有没有把私有事件帧（logs/report）映射成标准事件流，比单纯判「有没有
      // fetch」更贴合这条路径实际要考的东西，所以交给 judge 读代码语义。
      t.judge.autoevals
        .closedQA(
          `experiment 与 eval 是否真的关联到下面这个被测系统，而不是各写各的、互不搭界？
被测系统：${CORE_USE_CASE}
传输方式：${TRANSPORT}
合格标准：experiment 里配的 agent 确实用 WebSocket 连接 /ws、发送启动研究任务的帧，并把
服务端陆续推来的私有事件帧（如 logs / report）映射成 niceeval 的标准事件流（不是进程内直调
被测系统的函数，不是在 adapter 里启动被测进程，也不是用轮询 HTTP 假装处理了这条 WebSocket
协议）；eval 的输入贴着被测系统的真实核心用例写，断言检查的是该请求应该得到的具体结果。
不合格：eval 输入是 "hello" / "你好" / "test" 这类与业务无关的占位内容，或断言只有
t.succeeded() 而没有任何内容断言；experiment 引用的 agent 看不出与这个被测系统的真实连接。`,
          { on: `experiment 代码：\n${experimentSource}\n\neval 代码：\n${evalSource}` },
        )
        .atLeast(0.7);
    });

    // ── 第三层：路由层（计量，不 gate）。文档到底起没起作用。 ──────────
    const touched = bundledPagesTouched(t.events);

    await t.group("路由层", async () => {
      t.check(
        touchedIndex(t.events),
        isTrue(`以随包 INDEX.md 为路由入口（实际读到：${touched.join(", ") || "无"}）`).atLeast(1),
      );
      t.check(
        routedTo(t.events, EXPECTED_PAGES),
        isTrue(`读到与宿主形态匹配的页面（期望其一：${EXPECTED_PAGES.join(" | ")}）`).atLeast(1),
      );
      t.check(
        fellBackToOnlineDocs(t.events),
        isFalse("没有退回官网 / GitHub main 分支").atLeast(1),
      );
    });

    if (!touchedIndex(t.events) || !routedTo(t.events, EXPECTED_PAGES)) {
      t.diagnostic({
        code: "routing-miss",
        level: "warning",
        message: `路由未命中期望页面。实际读到：${touched.join(", ") || "无"}`,
        data: { touched, expected: EXPECTED_PAGES },
      });
    }

    turn.succeeded();
  },
});
