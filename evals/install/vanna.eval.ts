import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
import { SANDBOX_INIT_DOC_PATH, assertPagesInCandidate } from "../../lib/candidate.ts";
import { assertNiceevalInstalled } from "../../lib/mechanism.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 Vanna（自然语言转 SQL 的 agent 框架）。
 *
 * 宿主是 Python 项目，没有 package.json，agent 必须走 INIT.md 第 1 步那条分支——
 * 就地新建一个 package.json 来承载三件套。协议是 Vanna 自己的 JSON 请求/响应
 * （chat_poll，非流式），没有任何内置件能直接对上，考的是「手写 send + 读懂真实业务」。
 *
 * 就地新建的子目录不在 workdir 根，所以「niceeval 装哪去了」不能假设根目录——
 * `assertNiceevalInstalled` 背后的 `locateInstall` 本身已经兼容这条分支。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/tutorials/quickstart.mdx",
];

const CORE_USE_CASE =
  "一个自然语言转 SQL 的数据库问答 agent（Vanna）：问「2010 年的销售总额是多少」应该生成一条" +
  "含 SELECT 与聚合函数（如 SUM）的 SQL，并执行后返回具体数值；问知识库训练数据之外的表" +
  "应该明确答不知道，而不是编造字段名" +
  "（注：常见 demo 库 Chinook 的发票数据落在 2009–2013 年，若被测方连的是这份 demo 数据，" +
  "问「上个月」在当前日期下会合法地查到零行——问题特意钉在数据范围内的年份，避免这类假阴性）";

const TRANSPORT = "HTTP POST /api/vanna/v2/chat_poll（Vanna 自研 JSON 请求/响应，非流式）";

export default defineEval({
  description: "把 niceeval 接入 Vanna（自然语言转 SQL 的开源 agent 框架）",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/vanna-ai/vanna.git",
      ref: "v2.0.2",
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
      // Vanna 自带一个 frontends 目录；排除掉避免和 agent 写的 adapter 混在一起
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "frontends"],
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
      // 「问知识库训练数据之外的表应该明确答不知道」是 Vanna 这条路径特有的反幻觉
      // 要求——判 eval 有没有真的覆盖这条分支，而不只覆盖「问得到答案」的正向用例。
      t.judge.autoevals
        .closedQA(
          `experiment 与 eval 是否真的关联到下面这个被测系统，而不是各写各的、互不搭界？
被测系统：${CORE_USE_CASE}
传输方式：${TRANSPORT}
合格标准：experiment 里配的 agent 确实通过上面这个传输方式与被测系统通信（不是进程内直调
被测系统的函数，也不是在 adapter 里启动被测进程）；eval 的输入贴着被测系统的真实核心用例写，
断言检查的是该请求应该得到的具体结果，且覆盖了「问训练数据之外的表该答不知道，而不是编造
字段名」这条反幻觉分支。
不合格：eval 输入是 "hello" / "你好" / "test" 这类与业务无关的占位内容、只覆盖正向用例，
或断言只有 t.succeeded() 而没有任何内容断言；experiment 引用的 agent 看不出与这个被测系统
的真实连接。`,
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
