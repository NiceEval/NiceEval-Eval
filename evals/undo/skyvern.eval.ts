import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { runGenericChecks } from "../../lib/mechanism.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 Skyvern（用浏览器替你办事的操作型 agent）。
 *
 * 这条路径的被测行为不是「问答」而是「操作」：给一个自然语言任务 + 起始 URL，agent 真的
 * 开浏览器导航、在页面上抽取字段。协议是异步两跳的轮询——POST /api/v1/run/tasks 提交任务
 * 拿 run_id，再轮询 GET /api/v1/runs/{run_id} 直到 status 到 completed/failed 终态，从结果里
 * 取抽取产物（非流式）。考的是「手写异步提交 + 轮询终态」这条 request/poll 模式，niceeval 没有
 * 内置件能直接对上。
 *
 * skyvern-frontend / docs 两个顶层目录与「装 niceeval」无关且 frontend 是 TS，clone 时剪掉——
 * 既省体积，也避免 readSourceFiles 把宿主的前端 .ts 混进 agent 写的 adapter 里。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/tutorials/quickstart.mdx",
];

const CORE_USE_CASE =
  "一个用浏览器替你办事的操作型 agent（Skyvern）：给它「打开某个结构稳定的页面（如某维基/商品详情页），" +
  "找到指定字段并返回它的值」，agent 应真的导航到该页、从页面上抽出那个具体字段返回（如价格、版本号、标题）；" +
  "让它抽一个页面上根本不存在的字段，应明确报「找不到 / 页面上没有」而不是编一个看似合理的值";

const TRANSPORT =
  "HTTP POST /api/v1/run/tasks 提交任务（body 含 prompt 与起始 url，x-api-key 鉴权）拿 run_id，" +
  "再轮询 HTTP GET /api/v1/runs/{run_id} 直到 status 到 completed/failed 终态，从结果里取抽取产物（异步非流式轮询）";

export default defineEval({
  description: "把 niceeval 接入 Skyvern（浏览器操作自动化 agent）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/Skyvern-AI/skyvern.git",
      ref: "v1.0.47",
      excludeDirs: ["skyvern-frontend", "docs"],
    });

    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo, then finish the ` +
        `integration yourself — adapter, eval, and experiment. Nobody is available to confirm decisions with.\n\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 通用检查：安装链（gate）+ 通用品味（软分）。四条接入路径共用同一套判定。 ──
    await runGenericChecks(t, { version });

    // ── 第二层：产出质量层（judge）。按维度分别判 agent 写出的三件套质量。 ──
    // 读全量 agent 源码喂给 judge（含 adapter）——「传输方式对不对」只在 adapter 里看得见。
    // skyvern-frontend 已在 clone 时剪掉，这里再兜一层 ignoreDirs，确保喂给 judge 的 .ts
    // 只有 agent 自己写的。
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "skyvern-frontend"],
    });
    const isEval = (p: string) => /\.eval\.ts$/.test(p);
    const isExperiment = (p: string) => /(^|\/)experiments\//.test(p);
    const isConfig = (p: string) => /(^|\/)niceeval\.config\.ts$/.test(p);
    const label = (files: (typeof src)[number][]) =>
      files.map((f) => `----- ${f.path} -----\n${f.content}`).join("\n\n") || "（无）";

    const experimentSource = label(src.filter((f) => isExperiment(f.path)));
    const evalSource = label(src.filter((f) => isEval(f.path)));
    const adapterSource = label(
      src.filter((f) => !isExperiment(f.path) && !isEval(f.path) && !isConfig(f.path)),
    );
    const material =
      `# experiment\n${experimentSource}\n\n# eval\n${evalSource}\n\n# adapter / 其它 agent 写的源码\n${adapterSource}`;

    const DIMENSIONS: { key: string; threshold: number; criteria: string }[] = [
      {
        key: "传输保真",
        threshold: 0.7,
        criteria: `被测系统是「${CORE_USE_CASE}」，它对外的传输方式是：${TRANSPORT}。
判断：adapter（agent 手写的 send 实现）是否确实走这个「异步提交 + 轮询终态」的 HTTP 协议——POST 提交任务拿 run_id、
再轮询 GET run 直到终态、从结果里取抽取产物，并映射成 niceeval 的事件流？
合格（Y）：能看到 POST /run/tasks（带 x-api-key、body 有 prompt/url）、拿 run_id、循环 GET 轮询直到 completed/failed、解析抽取结果。
不合格（N）：adapter 进程内直接 import 并调用 skyvern 的函数；或在 adapter 里 spawn/启动 skyvern 进程；或只 POST 一次不轮询、拿不到终态结果；或根本没有对应的网络请求。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写——一个具体的、带起始 URL 的浏览器操作/抽取任务？
不合格（N）：输入是 "hello" / "你好" / "test" / "帮我上网查查" 这类没有具体页面与目标字段的寒暄或占位内容。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了这个抽取任务应得到的具体结果，而不是只判任务跑完？
合格（Y）：断言检查抽取产物里出现那个具体字段值（价格、版本号、标题等具体内容），用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「任务 status 是 completed」「有结果」这类与抽取内容无关的判定。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统操作真实网页，最核心的风险是：让它抽一个页面上根本不存在的字段时，它会编一个看似合理的值而不是明确报找不到。
判断：eval 是否包含一条针对这个负例的用例——让 agent 抽一个页面上不存在的字段，断言它明确报「找不到 / 页面上没有」且没有编造出一个具体值？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 Skyvern 浏览器操作 agent，而不是各写各的、互不搭界？
不合格（N）：experiment 用的是 echoAgent / 通用占位 agent，或引用的 agent 与 eval 的被测系统看不出关联。`,
      },
    ];

    await t.group("产出质量层", async () => {
      // judge 是软分（severity=soft），不 gate verdict——只把「装好了但产出质量差」量化出来。
      for (const d of DIMENSIONS) {
        t.judge.autoevals.closedQA(`【${d.key}】${d.criteria}`, { on: material }).atLeast(d.threshold);
      }
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
