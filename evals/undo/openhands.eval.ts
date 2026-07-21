import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { assertNiceevalInstalled } from "../../lib/mechanism.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../../lib/fixture.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 OpenHands（前身 OpenDevin，自主编码 agent）。
 *
 * 被测行为是「干活」而不是「问答」：给一个明确的编码任务，agent 真的建文件、写代码、跑命令，
 * 从一串 action / observation 事件里推进到完成。协议是 Socket.IO 事件流——先 REST
 * POST /api/conversations 建会话拿 conversation_id，再用 Socket.IO 连上（收 oh_event 事件、
 * 发 oh_user_action 动作），把服务端陆续推来的 action / observation 事件映射成 niceeval 的标准
 * 事件流，直到 agent 结束。这是四个 fixture 里第二条「手写流式协议映射」的路径，但帧协议
 * 与 GPT Researcher 的原生 WebSocket 不同——Socket.IO 有自己的 Engine.IO 握手与事件封装，
 * 用普通轮询 HTTP 假装处理不了这条协议。
 *
 * docs / frontend / evaluation 三个顶层目录与「装 niceeval」无关且 frontend 是 TS，clone 时剪掉——
 * 既省体积，也避免 readSourceFiles 把宿主的前端 .ts 混进 agent 写的 adapter 里。
 */

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/reference/events.mdx",
];

const CORE_USE_CASE =
  "一个能读写代码、跑命令的自主编码 agent（OpenHands）：给它一个明确的小任务，如「写一个函数计算斐波那契" +
  "第 10 项，运行它，并把结果打印出来」，agent 应真的创建/编辑文件、执行代码，并在完成时给出那个确定的" +
  "结果（第 10 项 = 55）；给它一个信息不足、明显无法完成的任务，不应假装完成、编一个结果";

const TRANSPORT =
  "先 REST HTTP POST /api/conversations 建会话拿 conversation_id，再用 Socket.IO 连上" +
  "（收 oh_event 事件、发 oh_user_action 动作），把服务端陆续推来的 action / observation 事件" +
  "映射成 niceeval 的标准事件流，直到 agent 结束（Socket.IO 事件协议，非普通 HTTP 请求/响应）";

export default defineEval({
  description: "把 niceeval 接入 OpenHands（自主编码 agent）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/OpenHands/OpenHands.git",
      ref: "1.11.0",
      excludeDirs: ["docs", "frontend", "evaluation"],
    });

    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo, then finish the ` +
        `integration yourself — adapter, eval, and experiment. Nobody is available to confirm decisions with.\n\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 第一层：检查 niceeval 是否安装好（gate）。四条接入路径共用同一套判定。 ──
    await assertNiceevalInstalled(t, { version });

    // ── 第二层：产出质量层（judge）。按维度分别判 agent 写出的三件套质量。 ──
    // 读全量 agent 源码喂给 judge（含 adapter）——「传输方式对不对」只在 adapter 里看得见。
    // frontend 已在 clone 时剪掉，这里再兜一层 ignoreDirs，确保喂给 judge 的 .ts
    // 只有 agent 自己写的。
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, "frontend"],
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
判断：adapter（agent 手写的 send 实现）是否确实走这个 Socket.IO 事件协议——先 REST 建会话拿 conversation_id、
再用 Socket.IO 连上、发 oh_user_action、把服务端推来的 oh_event（action / observation）映射成 niceeval 的事件流？
合格（Y）：能看到 POST /api/conversations 建会话、用 socket.io 客户端连接、发/收 oh_user_action / oh_event 并解析 action/observation。
不合格（N）：adapter 进程内直接 import 并调用 openhands 的函数；或在 adapter 里 spawn/启动 openhands 进程；或用普通轮询 HTTP 假装处理了这条 Socket.IO 协议；或根本没有对应的网络连接。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写——一个具体的、结果确定可核对的小编码任务？
不合格（N）：输入是 "hello" / "你好" / "test" / "帮我写点代码" 这类没有确定结果、无法核对的寒暄或占位内容。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了这个编码任务应得到的具体确定结果，而不是只判 agent 跑完？
合格（Y）：断言检查产出里出现那个确定结果（如斐波那契第 10 项 = 55，或某段代码的具体运行输出），用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「agent 结束了」「有产出」这类与具体结果无关的判定。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统是能自主干活的编码 agent，最核心的风险是：给它一个信息不足、无法完成的任务时，它会假装完成、编一个看似合理的结果。
判断：eval 是否包含一条针对这个负例的用例——给一个明显无法完成/信息不足的任务，断言 agent 明确表示无法完成/需要更多信息，而不是编造出一个已完成的结果？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 OpenHands 自主编码 agent，而不是各写各的、互不搭界？
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
