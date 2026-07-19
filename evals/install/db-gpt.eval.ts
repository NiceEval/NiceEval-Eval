import { defineEval } from "niceeval";
import { excludes, isFalse, isTrue } from "niceeval/expect";
import { SANDBOX_INIT_DOC_PATH } from "../../lib/candidate.ts";
import { assertNiceevalInstalled } from "../../lib/mechanism.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 DB-GPT（数据库对话式分析 + AWEL 工作流平台）。
 *
 * 仓库体积很大（完整 clone 接近 700MB，`docs/` 与 `assets/` 两个目录占了大头且与
 * 「装 niceeval」无关），所以用 sparse-checkout 剪掉。协议是
 * OpenAI Chat Completions 兼容形状（/v2/chat/completions），但 niceeval 没有对应内置件——
 * 兼容标准形状不等于零映射，仍然要手写 send。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/tutorials/quickstart.mdx",
];

const CORE_USE_CASE =
  "一个连着业务数据库的对话式数据分析 agent（DB-GPT）：问「这张表里销量最高的商品是什么」" +
  "应该返回具体的商品名并给出取数依据（查询了哪张表/哪个字段）；问数据源里不存在的表" +
  "应该明确答查不到，而不是编造结果";

const TRANSPORT = "HTTP POST /api/v2/chat/completions（OpenAI Chat Completions 兼容协议，Bearer API key 鉴权）";

export default defineEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  async test(t) {
    const candidateLabel = t.flags.candidateVersion as string | undefined;

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "v0.8.1",
      excludeDirs: ["docs", "assets"],
    });

    const turn = await t.send(`READ ${SANDBOX_INIT_DOC_PATH} and install niceeval for this repo.`);

    // ── 第一层：检查 niceeval 是否安装好（gate）。四条接入路径共用同一套判定。 ──
    await assertNiceevalInstalled(t, { candidateLabel });

    // ── 第二层：产出质量层（rubric / judge）。三件套符不符合公开文档声明的契约。 ──
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "web"],
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

    // 路由不理想时留一条永久记录，供事后按「哪一页没被读到」倒查文档。
    // 路由正常就不写——diagnostic 是用来记问题的，每次都写会把它变成噪声日志。
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
