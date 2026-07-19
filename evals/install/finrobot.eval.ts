import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
import { SANDBOX_INIT_DOC_PATH } from "../../lib/candidate.ts";
import { assertNiceevalInstalled } from "../../lib/mechanism.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 FinRobot（股票研究 agent 平台）。
 *
 * `run_web_app.py`（README 里文档化的官方入口）跑的是「提交任务 + 轮询状态」的
 * 异步形状（POST /api/run 拿 task_id，GET /api/status/{task_id} 轮询），而不是
 * 一次同步请求就拿到结果——adapter 的 send 需要在内部做完这整套轮询，再把最终
 * 报告作为一次 turn 的结果返回给 niceeval。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/tutorials/quickstart.mdx",
];

const CORE_USE_CASE =
  "一个股票研究 agent（FinRobot）：给定股票代码（如 NVDA）触发一次分析任务（POST /api/run 拿到 " +
  "task_id），轮询任务状态（GET /api/status/{task_id}）直到完成，取回的报告应该包含具体的财务" +
  "数据摘要与结论，而不是一句空泛的「分析已完成」";

const TRANSPORT = "HTTP（POST /api/run 提交任务 + GET /api/status/{task_id} 轮询，JSON 请求/响应）";

export default defineEval({
  description: "把 niceeval 接入 FinRobot（股票研究 agent 平台）",
  async test(t) {
    const candidateLabel = t.flags.candidateVersion as string | undefined;

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/AI4Finance-Foundation/FinRobot.git",
      ref: "v1.0.0",
    });

    const turn = await t.send(`READ ${SANDBOX_INIT_DOC_PATH} and install niceeval for this repo.`);

    // ── 第一层：检查 niceeval 是否安装好（gate）。四条接入路径共用同一套判定。 ──
    await assertNiceevalInstalled(t, { candidateLabel });

    // ── 第二层：产出质量层（judge）。experiment 与 eval 是否真的关联到这个被测系统。 ──
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: DEFAULT_SOURCE_IGNORE_DIRS,
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
      // FinRobot 的 send 必须自己做完「提交 + 轮询」这一整套异步流程——不轮询直接
      // 返回也能骗过一条「有没有 fetch」之类的静态断言，所以整套契约交给 judge
      // 去读代码语义，而不是拆成几条正则。
      t.judge.autoevals
        .closedQA(
          `experiment 与 eval 是否真的关联到下面这个被测系统，而不是各写各的、互不搭界？
被测系统：${CORE_USE_CASE}
传输方式：${TRANSPORT}
合格标准：experiment 里配的 agent 确实通过上面这个传输方式完成「提交任务 + 轮询状态」整套
流程与被测系统通信（不是进程内直调被测系统的函数，也不是在 adapter 里启动被测进程，也不是
只提交任务不轮询就把未完成的结果当成最终结果返回）；eval 的输入贴着被测系统的真实核心用例写，
断言检查的是该请求应该得到的具体结果。
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
