import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
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

    // ── 第二层：产出质量层（judge）。experiment 与 eval 是否真的关联到这个被测系统。 ──
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "web"],
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
      t.judge.autoevals
        .closedQA(
          `experiment 与 eval 是否真的关联到下面这个被测系统，而不是各写各的、互不搭界？
被测系统：${CORE_USE_CASE}
传输方式：${TRANSPORT}
合格标准：experiment 里配的 agent 确实通过上面这个传输方式与被测系统通信（不是进程内直调
被测系统的函数，也不是在 adapter 里启动被测进程）；eval 的输入贴着被测系统的真实核心用例写，
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
