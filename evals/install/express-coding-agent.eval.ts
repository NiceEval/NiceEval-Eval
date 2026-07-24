import { defineScoreEval } from "niceeval";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../lib/candidate.ts";
import { INDEX_RE, ONLINE_DOCS_RE } from "../../lib/routing.ts";
import { saveAgentOutput } from "./share/agent-archive.ts";
import { evalExecutionEvidence } from "./share/eval-adapter.ts";
import { evalExperiment } from "./share/eval-experiment.ts";
import { evalInstall } from "./share/eval-install.ts";
import { evalSandboxCreation } from "./share/eval-sandbox.ts";
import { agentSourceMaterial, cloneFixture } from "./share/fixture.ts";
import { buildQualityRubrics, type QualityFacts } from "./share/quality-criteria.ts";

/**
 * 接入路径：sandbox fixture 评 coding agent（宿主 Express，第六条路径）。
 *
 * 与前五条的本质区别：宿主不是 AI 应用而是普通 JS 库，被评对象是「coding agent 在这个
 * 仓库里干活」——niceeval 这条差异化路径不走自写 adapter（内置 sandbox agents），核心
 * 建材是 sandbox provider 与预制制品。核心考项因此是**有没有正确创建模板/沙箱**
 * （评估sandbox创建，见 ./share/eval-sandbox.ts），文档面考的是
 * sandbox-providers / fixtures / sandbox-agent 这三页。
 *
 * 宿主选 Express 4.21.2：纯 JS、无 tsconfig（评估安装的 tsc gate 只该管 agent 自己的代码，
 * TS 宿主会把宿主自身的编译问题连坐进来——宿主 devDependencies 没装时必红）；clone 小、
 * 测试套件真实，「评 coding agent 改它」的用例自然成立。
 */

// 等价落点组，命中其一即算路由正确。`(how-to|tutorials)` 同 db-gpt.eval.ts：把新旧两代
// 路径都编进去，候选里不存在的那代由 assertPagesInCandidate 兜底。
const EXPECTED_PAGES =
  /docs-site\/zh\/(how-to|tutorials)\/(sandbox-providers|fixtures|sandbox-agent)\.mdx/;

// 产出质量事实（判据机制见 ./share/quality-criteria.ts）。这条路径的「被测系统」是
// coding agent 本身，四维照用：用例=真实编码任务、断言=沙箱事实、负例=假完成风险。
const QUALITY: QualityFacts = {
  system: "coding agent（在 Express 仓库上跑编码任务）",
  coreUseCase:
    "评 coding agent 改真实代码：在隔离 workspace 里对 Express 仓库做一个具体的小编码任务" +
    "（修一个明确的行为缺陷 / 加一个小特性），产出用 sandbox 事实验证（跑测试命令、读改动文件、查 diff）",
  useCaseShape: "一个具体的编码任务描述（改什么行为、动哪块代码、完成标准是什么）",
  assertionPass:
    "断言落在 sandbox 事实上——在沙箱里跑测试/命令看退出码与输出、读被改的文件、查 diff——" +
    "而不是只判 agent 回复文本说没说「做完了」",
  negativeRisk:
    "coding agent 最核心的假完成风险：声称改完了但没跑测试或测试没过。负例应给一个不可完成的" +
    "任务（如基于 Express 里不存在的内部 API 做改动），断言它承认做不到/指出前提不存在，" +
    "而不是硬造一段「已完成」。",
};

// 交互层判据（各写各的，不走 ./share/clarify-criteria.ts）：那份机制的四件事里「问接口」
// 「摆 Tier 三档」都以自写 adapter 为前提，这条路径用内置 agents、没有 adapter 可分档。
// 这条路径动手前该问清的四件事：评谁、沙箱跑哪、要不要变体对比、有没有现成预制环境。
// 机制同源：judge 只判「问了没」不判「背得全不全」，一条判据只判一个点，各挂 1 分。
const CLARIFY_PREAMBLE =
  "背景：agent 收到「把 niceeval 装进这个仓库，用来评 coding agent 在仓库里干活的表现，" +
  "每个评估 attempt 要在隔离、可复现的沙箱里跑」的任务后，应当在动手改代码前先停下来，" +
  "回用户一条消息把仓库里看不出来的事问清楚。下面给你的就是它这条回复。\n" +
  "本条判据只判其中一个点，其它点由别的判据各自判——不要因为回复漏了别的点就给这一条判 N。\n";

const SANDBOX_CLARIFY: { key: string; criteria: string }[] = [
  {
    key: "问被评agent",
    criteria:
      `${CLARIFY_PREAMBLE}\n` +
      `判断：agent 有没有问用户「要评的 coding agent 是哪个」——如 Claude Code / Codex / bub` +
      `（niceeval 内置支持的几个），或给出候选让用户选？\n` +
      `合格（Y）：回复里有这个问题。\n` +
      `不合格（N）：整条回复没提要评谁；或直接替用户拍板选了一个且不请确认。`,
  },
  {
    key: "问沙箱选型",
    criteria:
      `${CLARIFY_PREAMBLE}\n` +
      `判断：agent 有没有把「沙箱跑在哪」摆出来交给用户核对——本地 Docker、云端 E2B / Vercel、` +
      `还是本机直跑，以及云 provider 的凭据从哪来？\n` +
      `合格（Y）：摆出了不止一个 provider 选项让用户挑，或问了云凭据/本地 Docker 可用性。\n` +
      `不合格（N）：整条回复没提沙箱环境跑在哪。`,
  },
  {
    key: "问变体对比",
    criteria:
      `${CLARIFY_PREAMBLE}\n` +
      `判断：agent 有没有问用户「要不要多个 model / 多个 agent 跑对比」——也就是要不要把变体` +
      `暴露成 experiment 配置？\n` +
      `合格（Y）：回复里有这个问题。\n` +
      `不合格（N）：整条回复没提多组对比 / 变体 / A-B。`,
  },
  {
    key: "问预制环境",
    criteria:
      `${CLARIFY_PREAMBLE}\n` +
      `判断：agent 有没有问「有没有现成的预制环境（template / 镜像 / 快照）可用，或要不要为` +
      `启动提速预制一份」？\n` +
      `合格（Y）：回复里有这个问题（问法不限：现成 template、要不要烘焙镜像、环境复用都算）。\n` +
      `不合格（N）：整条回复没提预制 / 环境复用 / 启动加速。`,
  },
];

export default defineScoreEval({
  description: "为 Express 仓库搭一套评 coding agent 的沙箱评估（考 sandbox/template 创建）",
  // INIT.md 的完成清单含「真跑一次并 show 可见」，这条路径真跑一轮 = 嵌套跑一个 coding agent
  // 任务，与前五条起被测服务同量级，install 组统一放宽的 35min 照用。
  timeoutMs: 35 * 60 * 1000,
  async test(t) {
    const version = t.flags.candidateVersion as string;

    // 合格落点必须在这个候选里真实存在，否则「评估是否正确加载文档」只会静默读零
    assertPagesInCandidate(EXPECTED_PAGES, version);

    await cloneFixture(t.sandbox, {
      repoUrl: "https://github.com/expressjs/express.git",
      ref: "4.21.2",
    });

    // 前五条的 send 是同一份文案——宿主是什么 AI 系统，仓库自己会说话。这条的宿主是普通
    // JS 库，「评的是 coding agent、每个 attempt 要隔离可复现」是用户意图、仓库里看不出来，
    // 必须进 send。只进**要求**（隔离/可复现），不进**解法**（provider 选型/预制模板/官方
    // 基线）——解法该由文档教，是这道题的读数。
    const turn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
      `We want to evaluate coding agents working on real tasks in this repo — ` +
      `every eval attempt must run in an isolated, reproducible environment.\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    // ── 评估交互（各写各的，机制同 evalInteraction：判第一轮回复，加分不 gate） ──────
    const clarifyReply = t.reply;
    await t.group("评估交互", async () => {
      t.parked().points(1);
      for (const r of SANDBOX_CLARIFY) {
        t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, { on: clarifyReply }).points(1);
      }
    });

    // 罐头答复（机制同 evalInteraction 的 PICK_TIER_1：真 park 了走 respond，没 park 用同
    // session 下一条消息递过去；一次答完 agent 实际会问的事，关掉「继续等确认」的口子）。
    // 「评估环境要预制好、attempt 里别现装」是任务要求；怎么预制（template 派生/版本化/
    // 分层）不提——那是文档该教的，也是评估sandbox创建在判的。云凭据说清楚只在 CI 有，
    // 给 agent 一条本地能真跑通的路，预制制品以构建脚本形态交付、不要求真构建。
    const PICK_SANDBOX =
      "评 codex 就行——这台机器上已有它的 CLI。评估环境要预制好、attempt 里别现装：" +
      "云端用 e2b，但云凭据只在 CI 有，本地不用真构建，预制的构建定义写好即可；" +
      "本地先用最省的方式把一轮最小任务真跑通。写两个实验（baseline + 一个 model 对比），" +
      "先不接 otel、也先不做变体 flag。其余你自行决定，不用再等我确认。";
    if (turn.status === "waiting") {
      await t.respond(PICK_SANDBOX);
    } else {
      await t.send(PICK_SANDBOX);
    }

    // ── 通用检查：评估安装（gate + 过程侧）+ 评估exp质量（软分）+ 评估执行取证（加分）。
    // ── 评估adapter 不调：这条路径没有自写 adapter，「联上被测系统」无从谈起。 ────────
    await evalInstall(t, { version });
    await evalExperiment(t);
    await evalExecutionEvidence(t);

    // ── 产出质量层（纯加分）+ 核心考项：评估sandbox创建（gate + 加分 + judge 三维）。 ──
    const material = await agentSourceMaterial(t.sandbox);

    await t.group("产出质量层", async () => {
      // 同前五条：每维一条独立 closedQA，Y 挣 1 分、N 挣 0 分，不 gate。
      for (const r of buildQualityRubrics(QUALITY)) {
        t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, { on: material }).points(1);
      }
    });

    await evalSandboxCreation(t, { material });

    // ── 宿主专属·评估是否正确加载文档（计量，不 gate）。 ────────────────────────────
    // 不判 TIER_PAGE_RE：tier 三档是自写 adapter 路径的知识点，这条路径的交互层没有那条
    // 判据，读没读 tier 页不构成这道题的读数。
    await t.group("评估是否正确加载文档", async () => {
      t.calledTool("shell", { input: { command: INDEX_RE } }).points(1); // 以随包 INDEX.md 为路由入口
      t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).points(1); // 读到 sandbox 这条路径的页面
      t.notCalledTool("shell", { input: { command: ONLINE_DOCS_RE } }).points(1); // 没退回官网 / GitHub main
    });

    // 生命周期收尾：归档产物供人工 review（沙箱销毁前抓一份，纯落盘不影响 verdict）。
    await saveAgentOutput(t, "express-coding-agent");

    turn.succeeded();
  },
});
