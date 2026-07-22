import { defineEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
// undo 未来会并入 install,这两个判据本就是 install 那组的共用件——先借用,合并时这两行自然消失
import { runGenericChecks } from "../install/share/checks-generic.ts";
import { cloneFixture, DEFAULT_SOURCE_IGNORE_DIRS } from "../install/share/fixture.ts";

/**
 * 接入路径：真实开源项目 Letta（前身 MemGPT，有状态记忆对话 agent）。
 *
 * 这条路径独有的维度是「多轮有状态」：agent 不是无状态问答，而是把说过的事实写进
 * 记忆块并跨轮复用。协议也因此有两跳——先 POST /v1/agents 建一个 agent 拿 agent_id，
 * 再 POST /v1/agents/{agent_id}/messages 发消息，且多轮必须复用同一个 agent_id，否则
 * 记忆无从谈起。响应不是 OpenAI 形状，而是 reasoning / tool_call / assistant 等分型
 * 消息组成的 JSON 列表，考的是「读懂被测系统自己的消息模型 + 维持会话状态」。
 */

const EXPECTED_PAGES =
  /docs-site\/zh\/how-to\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/;

const CORE_USE_CASE =
  "一个有状态记忆的对话 agent（Letta / MemGPT）：第一轮告诉它「我叫韩梅梅、正在做一个叫 Orbit 的项目」，" +
  "agent 应把这些事实写进它的记忆块；后续轮问「我叫什么名字、在做什么项目」应准确复述之前说过的具体事实" +
  "（韩梅梅 / Orbit），而不是重新反问或答非所问；问一件从没告诉过它的私人信息（如「我住在哪个城市」）" +
  "应明确说不知道，而不是编一个具体城市名";

const TRANSPORT =
  "先 HTTP POST /v1/agents 建一个 agent 拿 agent_id，再 HTTP POST /v1/agents/{agent_id}/messages 发消息" +
  "（Bearer LETTA_SERVER_PASSWORD 鉴权；响应是 reasoning / tool_call / assistant 等分型消息的 JSON 列表，" +
  "非 OpenAI 形状）；多轮必须复用同一个 agent_id 以维持记忆";

export default defineEval({
  description: "把 niceeval 接入 Letta（有状态记忆对话 agent / MemGPT）",
  environment: "python",
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/letta-ai/letta.git",
      ref: "0.16.8",
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
    // Letta 是 Python 宿主，.ts 基本只有 agent 自己写的，全量喂进去不会混入宿主代码。
    const src = await t.sandbox.readSourceFiles({
      extensions: ["ts"],
      ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS],
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
判断：adapter（agent 手写的 send 实现）是否确实通过这个两跳的 HTTP 协议与被测系统通信——先建 agent 拿 agent_id、再往
/v1/agents/{agent_id}/messages 发消息，并把响应里的分型消息映射成 niceeval 的事件流？
合格（Y）：能看到向这两个 HTTP 端点发请求、带 Authorization: Bearer、解析响应里的 assistant / reasoning 等消息并产出文本/事件。
不合格（N）：adapter 进程内直接 import 并调用 letta 的函数；或在 adapter 里 spawn/启动 letta 服务进程；或根本没有对应的网络请求。`,
      },
      {
        key: "用例贴合",
        threshold: 0.7,
        criteria: `被测系统的真实核心用例：${CORE_USE_CASE}
判断：eval 的 t.send() 输入是否贴着这个真实业务用例写——一个具体的、告诉 agent 某个事实、随后要它复述该事实的记忆场景？
不合格（N）：输入是 "hello" / "你好" / "test" 这类与业务无关的寒暄或占位内容。`,
      },
      {
        key: "断言具体",
        threshold: 0.7,
        criteria: `判断：eval 是否真的验证了「跨轮记忆」——即先在一轮里告诉 agent 一个具体事实，再在后续轮里问它，
断言后续轮的回答里出现之前说过的那个具体事实（如名字「韩梅梅」、项目名「Orbit」）？
合格（Y）：能看到多轮交互（复用会话/agent 状态），且断言用 matcher 或 judge 检查回答里出现之前提供的具体事实。
不合格（N）：整个 eval 只有单轮、或只有 turn.succeeded()、或只断言「有回答 / 回答长度>0」这类与记忆内容无关的判定。`,
      },
      {
        key: "负例覆盖",
        threshold: 0.5,
        criteria: `被测系统是有记忆的 agent，最核心的风险是：问一件从没告诉过它的私人信息时，它会编一个看似合理的具体值而不是承认不知道。
判断：eval 是否包含一条针对这个负例的用例——问一件从没在对话里提供过的私人信息（如所在城市），断言 agent 明确答「不知道 / 你没告诉过我」且没有编造出一个具体值？`,
      },
      {
        key: "实验-eval 耦合",
        threshold: 0.7,
        criteria: `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 Letta 有状态记忆 agent，而不是各写各的、互不搭界？
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
    // 判据是碰过哪个路径、不是用了哪个工具：codex 走 shell 读文件（cat/rg），路径落在
    // input.command 里；calledTool 的 RegExp 只测 input 侧，各种读法都接得住。miss 时想看
    // 「实际读了哪几页」拿不到——那是 calledTool 的 arg 缺口，已记去反馈 niceeval，不再手搓解析。
    await t.group("路由层", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1); // 读到与宿主形态匹配的页面
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).atLeast(1); // 没退回官网 / GitHub main
    });

    turn.succeeded();
  },
});
