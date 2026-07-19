import { defineEval } from "niceeval";
import { excludes, isFalse, isTrue } from "niceeval/expect";
import { SANDBOX_INIT_DOC_PATH } from "../../lib/candidate.ts";
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
  "一个自然语言转 SQL 的数据库问答 agent（Vanna）：问「上个月的销售总额是多少」应该生成一条" +
  "含 SELECT 与聚合函数（如 SUM）的 SQL，并执行后返回具体数值；问知识库训练数据之外的表" +
  "应该明确答不知道，而不是编造字段名";

const TRANSPORT = "HTTP POST /api/vanna/v2/chat_poll（Vanna 自研 JSON 请求/响应，非流式）";

export default defineEval({
  description: "把 niceeval 接入 Vanna（自然语言转 SQL 的开源 agent 框架）",
  async test(t) {
    const candidateLabel = t.flags.candidateVersion as string | undefined;

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/vanna-ai/vanna.git",
      ref: "v2.0.2",
    });

    const turn = await t.send(`READ ${SANDBOX_INIT_DOC_PATH} and install niceeval for this repo.`);

    // ── 第一层：检查 niceeval 是否安装好（gate）。四条接入路径共用同一套判定。 ──
    await assertNiceevalInstalled(t, { candidateLabel });

    // ── 第二层：产出质量层（rubric / judge）。三件套符不符合公开文档声明的契约。 ──
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      // Vanna 自带一个 frontends 目录；排除掉避免和 agent 写的 adapter 混在一起
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "frontends"],
    });
    const adapterSource =
      src.find((f) => /agents?\//.test(f.path))?.content ??
      src.fileMatching(/defineAgent|defineSandboxAgent|uiMessageStreamAgent/)?.content ??
      "";
    const evalSource = src.find((f) => /\.eval\.ts$/.test(f.path))?.content ?? "";

    await t.group("产出质量层", async () => {
      t.check(
        adapterSource,
        excludes(/from\s+["']\.\.?\/(?!.*niceeval).*\/(app|server|index|routes)/, {
          stripComments: true,
        }).atLeast(1),
      );
      t.check(
        adapterSource,
        excludes(/\b(spawn|exec|execa|child_process)\b/, { stripComments: true }).atLeast(1),
      );
      t.check(adapterSource, excludes(/process\.env\./, { stripComments: true }).atLeast(1));

      // 「问知识库训练数据之外的表应该明确答不知道」是 Vanna 这条路径特有的反幻觉
      // 要求——判 eval 有没有真的覆盖这条分支，而不只覆盖「问得到答案」的正向用例。
      t.judge.autoevals
        .closedQA(
          `这段 eval 代码是否针对下面这个被测系统的真实核心用例编写？
被测系统：${CORE_USE_CASE}
合格标准：eval 的输入是一个该系统真实会遇到的请求，断言检查的是该请求应该得到的具体结果，
且覆盖了「问训练数据之外的表该答不知道，而不是编造字段名」这条反幻觉分支。
不合格：输入是 "hello" / "你好" / "test" 这类与业务无关的占位内容，只覆盖正向用例，
或断言只有 t.succeeded() 而没有任何内容断言。`,
          { on: evalSource },
        )
        .atLeast(0.7);

      t.judge.autoevals
        .closedQA(
          `这段 adapter 代码是否通过 ${TRANSPORT} 与被测系统通信，而不是在进程内直接 import 被测系统的函数？
合格：用 fetch / HTTP 请求等真实传输方式，被测系统的地址与鉴权来自工厂参数。
不合格：直接 import 应用代码后调用其函数，或在 adapter 内部启动被测进程。`,
          { on: adapterSource },
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
