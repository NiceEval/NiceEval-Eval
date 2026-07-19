import { defineEval } from "niceeval";
import { excludes, isFalse, isTrue } from "niceeval/expect";
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

    // ── 第二层：产出质量层（rubric / judge）。三件套符不符合公开文档声明的契约。 ──
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: DEFAULT_SOURCE_IGNORE_DIRS,
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

      // FinRobot 的 send 必须自己做完「提交 + 轮询」这一整套异步流程，只判有没有
      // spawn/exec 之类的进程作弊防不住这条——不轮询直接返回也能骗过静态断言，
      // 所以核心用例契约交给 judge 去读代码语义。
      t.judge.autoevals
        .closedQA(
          `这段 eval 代码是否针对下面这个被测系统的真实核心用例编写？
被测系统：${CORE_USE_CASE}
合格标准：eval 的输入是一个该系统真实会遇到的请求，断言检查的是该请求应该得到的具体结果。
不合格：输入是 "hello" / "你好" / "test" 这类与业务无关的占位内容，或断言只有 t.succeeded() 而没有任何内容断言。`,
          { on: evalSource },
        )
        .atLeast(0.7);

      t.judge.autoevals
        .closedQA(
          `这段 adapter 代码是否通过 ${TRANSPORT} 与被测系统通信，而不是在进程内直接 import 被测系统的函数？
合格：用 fetch / HTTP 请求等真实传输方式完成「提交任务 + 轮询状态」整套流程，被测系统的地址与
鉴权来自工厂参数。
不合格：直接 import 应用代码后调用其函数，在 adapter 内部启动被测进程，或者只提交任务不轮询
就把未完成的结果当成最终结果返回。`,
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
