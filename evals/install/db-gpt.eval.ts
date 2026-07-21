import { defineEval } from "niceeval";
import { isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { runGenericChecks } from "../../lib/mechanism.ts";
import { saveAgentOutput } from "../../lib/agent-archive.ts";
import { cloneFixture } from "../../lib/fixture.ts";
import {
  assertAdapterRanLive,
  type QualityDimension,
  runQualityDimensions,
} from "../../lib/produce-quality.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "../../lib/routing.ts";

/**
 * 接入路径：真实开源项目 DB-GPT（数据库对话式分析 + AWEL 工作流平台）。
 *
 * 仓库体积很大（完整 clone 接近 700MB，`docs/` 与 `assets/` 两个目录占了大头且与
 * 「装 niceeval」无关），所以用 sparse-checkout 剪掉。协议是
 * OpenAI Chat Completions 兼容形状（/v2/chat/completions），但 niceeval 没有对应内置件——
 * 兼容标准形状不等于零映射，仍然要手写 send。
 */

// 等价落点组，任意一页命中即算路由正确。how-to/ 与 tutorials/ 是同一批页面在
// 新旧版本里的两代路径（0.10.x 起 how-to/ 并入 tutorials/），同时列上，
// 同一份题库才能横跨新旧候选对比；候选里不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES = [
  "docs-site/zh/how-to/connect-your-agent.mdx",
  "docs-site/zh/how-to/write-send.mdx",
  "docs-site/zh/tutorials/connect-your-agent.mdx",
  "docs-site/zh/tutorials/write-send.mdx",
  "docs-site/zh/tutorials/quickstart.mdx",
];

const CORE_USE_CASE =
  "一个连着业务数据库的对话式数据分析 agent（DB-GPT）：问「这张表里销量最高的商品是什么」" +
  "应该返回具体的商品名并给出取数依据（查询了哪张表/哪个字段）；问数据源里不存在的表" +
  "应该明确答查不到，而不是编造结果";

const TRANSPORT = "HTTP POST /api/v2/chat/completions（OpenAI Chat Completions 兼容协议，Bearer API key 鉴权）";

export default defineEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "v0.8.1",
      excludeDirs: ["docs", "assets"],
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

    // ── 通用检查·能动性层（软分，不 gate）。adapter 真能把一条 DB-GPT 回应拉回来吗。 ──
    // 读 agent 内层真跑落盘的 events，独立判有没有实质回应；实现见 lib/produce-quality.ts。
    await assertAdapterRanLive(t);

    // ── 宿主专属·产出质量层（judge 软分）。按维度分别判 agent 写出的三件套质量。 ──
    // 判据材料（三件套源码、必须含 adapter）由 runQualityDimensions 内部经 openProject
    // 取得，契约见 lib/produce-quality.ts 头注。
    // 老版本一条 closedQA 把「传输对不对 / 输入贴不贴业务 / 断言够不够具体」揉成一个二值
    // 判定，红了也说不清红在哪。改成按维度拆成多条各自可证伪的 judge：分数因此是分维度的
    // （更高级），且能直接倒查是哪一维塌了。每条都喂全量源码（含 adapter）。
    // 前五个维度都用离线 judge-probe 对「理想好样本 / 占位 / 进程内直调 / 真传输弱断言 /
    // 一次真实 attempt 的产出」五类样本验证过，逐维判定与预期一致：理想样本全 1；进程内直调
    // 与占位在 transport 上判 0；真实那次（真发 HTTP+SSE 的 adapter、但 eval 只问「怎么用
    // CSV 分析」这类元问题、无负例）落在 0.60——transport/assertion/coupling=1，usecase/
    // negative=0，正是想要的分维度反馈，而不是一个说不清的二值。
    // 「能力对准」维度与「元问题 / 重言式断言」两条不合格形态是 v0.9.1 evd2 那次真实产出
    // 暴露后补的（chat_normal 全绿、includes(/data|database|SQL/i) 判了 1），还没过 probe。
    const DIMENSIONS: QualityDimension[] = [
      {
        key: "传输保真",
        threshold: 0.7,
        criteria: `被测系统 DB-GPT 是一个独立运行的服务，agent 必须通过网络与它通信。它对外暴露 HTTP API，代表性端点是：${TRANSPORT}；但 agent 也可能选用 DB-GPT 其它等价的 HTTP 端点（如 /api/v1/chat/... 系列）——判据是「有没有真的走 DB-GPT 服务的 HTTP 接口」，不是「用了哪一个具体路径」。
判断：adapter（agent 手写的 send 实现）是否确实通过对 DB-GPT 服务发 HTTP 请求来通信，并把响应（含 SSE/stream 解帧）映射成 niceeval 的事件流？
合格（Y）：能看到向 DB-GPT 服务的某个 HTTP 端点发请求（fetch/POST 到 baseUrl 下的路径）、通常带 Authorization: Bearer、解析响应并产出文本/事件。/api/v2/chat/completions、/api/v1/chat/react-agent 等 DB-GPT 端点都算合格。
不合格（N）：adapter 进程内直接 import 并调用被测系统的 Python/函数；或在 adapter 里 spawn/启动被测系统进程；或根本没有对 DB-GPT 服务的网络请求。`,
      },
      {
        // v0.9.1 实测漏洞：adapter 用 chat_mode:"chat_normal" 走纯 LLM 聊天，6 条回应全绿
        // 但没有一条真的碰过数据源——传输保真（真发了 HTTP）和动态验证（真收到回应）都拦不住
        // 「接通了产品外壳、绕开了产品能力」这种形态，所以单独立一维。
        key: "能力对准",
        threshold: 0.7,
        criteria: `被测系统 DB-GPT 的核心能力是「连着数据源的对话式数据分析」，不是它顺带暴露的通用 LLM 聊天代理。
判断：adapter 发起的请求是否真的走 DB-GPT 的数据对话能力？
合格（Y）：chat_mode 是 chat_with_db_execute / chat_with_db_qa / chat_data / chat_dashboard 等连库模式，或请求参数里带 chat_param / 数据源名等指向具体数据源的配置。
不合格（N）：chat_mode 是 "chat_normal"（或等价的纯聊天模式）且没有任何数据源指向——那评的是底层 LLM，不是 DB-GPT。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写（一个具体的、与业务数据库相关的自然语言分析问题）？
不合格（N）：输入是 "hello" / "你好" / "test" / "帮我看看数据" 这类与具体业务无关的寒暄或占位内容；或是「DB-GPT 能处理什么数据 / 你能做什么」这类**问被测系统它自己的元问题**——那不是用户拿它做数据分析的用例。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 的断言是否检查了该问题应得到的具体结果，而不是只判跑通？
合格（Y）：断言检查回答里出现具体业务内容（商品名、取数依据的表名/字段名、具体数值等），用 matcher 或 judge 对内容做判定。
不合格（N）：整个 eval 只有 turn.succeeded()，或只断言「回答长度>0」「有回答」这类与内容无关的判定；或断言是**重言式**——断言的关键词/正则在 t.send() 的输入里本来就出现过（如问「数据分析」再断言回答含 /data|数据/），被测方复读题目即可通过，这种断言没有区分度，判 N。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统连着真实数据库，最核心的风险是：问数据源里不存在的表/数据时，它会编造一个看似合理的结果而不是明确答查不到。
判断：eval 是否包含一条针对这个负例的用例——问不存在的表/数据，断言被测方明确答「查不到 / 不存在」且没有编造出具体结果？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 DB-GPT（数据库对话分析 agent），而不是各写各的、互不搭界？
不合格（N）：experiment 用的是 echoAgent / 通用占位 agent，或引用的 agent 与 eval 的被测系统看不出关联。`,
      },
    ];

    await runQualityDimensions(t, DIMENSIONS);

    // ── 宿主专属·路由层（计量，不 gate）。文档到底起没起作用。 ──────────
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

    // 生命周期收尾：把 agent 写出的三件套 copy 到本地 .agent-output/（gitignore）供人工 review。
    // 沙箱马上就销毁，产物随之消失——趁现在抓一份。纯落盘，不影响 verdict。
    await saveAgentOutput(t, "db-gpt");

    turn.succeeded();
  },
});
