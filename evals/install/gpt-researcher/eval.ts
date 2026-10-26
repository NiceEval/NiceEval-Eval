/**
 * GPT Researcher install：候选 INIT.md + 随包文档能否把 coding agent 带到真实、可复审的 NiceEval 接入。
 *
 * 分数是 Adapter、Experiment、Eval、真实证据与首轮理解的自然价值累加，不设总分上限，
 * 也不为必要但无区分度的安装事实发分：精确版本、config、CLI discovery、有效 dry plan、
 * 交接 locator 和取证命令只做 gate。源码先评，安装或运行失败不会抹掉源码证据。
 */

import { defineScoreEval } from "niceeval";
import { commandSucceeded, countWhere, equals, greaterThan, isDefined, or, referencesAnyPath, toolMatch } from "niceeval/expect";
import { actionRef, command, gitCheckout, sandboxRequirements } from "niceeval/sandbox";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";
import {
  archiveAgentOutput,
  locateInstallRoot,
  readAuthoredSource,
  runCandidateCli,
} from "../../../lib/install-probes.ts";
import { YES, yesNo } from "../../../lib/judge.ts";
import { query } from "../../../lib/query.ts";

/**
 * [key, label, points, question]：交给首轮的任务、命令输入、HITL 请求与回复。
 * 每项只问一件可以独立缺失的事，报告里能直接看到缺的是哪一项。
 */
const FIRST_TURN_QUESTIONS = [
  ["install.first-turn.protocol", "核对接入协议", 2,
    "agent 是否说明了它从仓库确认的 GPT Researcher 接入协议，并且本轮工具调用里能看到它读过对应源码或配置？" +
    "主路径是 FastAPI /ws：客户端发送 `start ` + JSON，服务端依次返回 logs/images/report/path 帧；REST 入口也不是 OpenAI Chat Completions 形状。只说“调 API”或猜成 OpenAI messages 接口判 N。"],
  ["install.first-turn.capability", "核对能力边界", 2,
    "agent 是否说明核心能力是自主检索多源资料并生成带引用的结构化研究报告，而不是普通对话。"],
  ["install.first-turn.ask-tier", "询问 Tier 与观测", 1,
    "agent 是否在动手实现前询问了Tier 选择，以及是否使用 LangSmith 或另接观测？"],
  ["install.first-turn.ask-model", "询问模型与变体", 1,
    "agent 是否在动手实现前询问了目标模型/搜索配置，或 report_type/tone/report_source 变体？"],
  ["install.first-turn.ask-budget", "询问首跑预算", 1,
    "agent 是否在动手实现前询问了首跑的 Attempt 数、时间或费用预算？"],
  ["install.first-turn.pause", "首轮停下等用户决定", 1,
    "agent 是否在写代码前明确停下，把需要用户决定的选择留给用户？正式 HITL waiting 或普通文本请求确认都算；" +
    "只反问本应从仓库查明的接口事实不算。"],
  ["install.first-turn.use-case", "提出核心用例", 2,
    "agent 是否主动提出了一条具体的首个 Eval 核心用例：对具体主题自主检索多源资料，产出带引用来源的结构化研究报告正文。仅提 hello、任务提交回执或非空回复判 N。"],
  ["install.first-turn.success", "说明成功判据", 1,
    "agent 是否说明了这条用例可观察的业务成功结果，例如检查主题相关实质内容、结构化章节和引用 URL？"],
  ["install.first-turn.risk", "指出主要风险", 1,
    "agent 是否指出了主要失败风险，例如虚构主题被写成看似有据的报告？"],
] as const;

/** [key, label, points, rubric]：只看 agent 写出的三件套源码。 */
const SOURCE_RUBRICS = [
  ["install.adapter.target-protocol", "真实 GPT Researcher 协议与请求响应语义", 8,
    "Y 当且仅当 Adapter 连接 GPT Researcher 仓库真实提供的 FastAPI /ws，" +
    "按协议发送 `start ` + JSON（含 task/report_type/report_source/tone 等选中字段），并按 logs/images/report/path 帧语义解析；" +
    "或使用仓库中被源码证明的真实 REST 入口及其实际 shape。假设 OpenAI messages 形状、进程内直调或静态回复判 N。"],
  ["install.adapter.response-mapping", "真实 report 映射为 NiceEval 消息或事件", 6,
    "Y 当且仅当 NiceEval 助手消息或标准事件的最终文本来自 GPT Researcher 的 report 帧，" +
    "并将 logs/images/path 按各自语义处理，不把进度日志或 path 当成报告。返回输入原文、固定 ASSISTANT 文字或仅说任务已提交判 N。"],
  ["install.adapter.variables-forwarded", "模型、配置与实验变量传到 GPT Researcher", 3,
    "Y 当且仅当 Adapter/lifecycle 真正读取 model 以及所选静态研究配置（如 report_type、tone、report_source），" +
    "并把它们传入 GPT Researcher 请求或目标进程。只在 Experiment 声明但没有读取，或全部被硬编码覆盖，判 N。"],
  ["install.adapter.cancel-timeout", "取消与超时", 1,
    "Y 当且仅当 send 把 NiceEval AbortSignal 或等价取消机制传给WebSocket/HTTP 连接，并设置有界超时。"],
  ["install.adapter.error-propagation", "错误不被吞掉", 2,
    "Y 当且仅当在连接失败、非正常 close、帧解析错误、error 帧或未收到 report时抛出或映射为失败。catch 后改返成功空文本或吞错判 N。"],
  ["install.adapter.credential-boundary", "凭证边界正确", 2,
    "Y 当且仅当 LLM/搜索凭证只从环境/目标服务进程边界读取，不硬编码，不写入工作区，不打印，也不混入 Eval 文本或取证输出；" +
    "/opt/fixture-secrets/target-app.env 只注入目标服务进程，不 source 到 agent shell。"],
  ["install.eval.core-input", "输入覆盖 GPT Researcher 核心能力", 6,
    "Y 当且仅当至少一条 Eval 输入要求对具体、可研究的主题自主检索多源资料，产出带引用来源的结构化研究报告正文。" +
    "合格形状是：具体研究主题，输出应包含实质内容、结构化章节和引用 URL。hello、自我介绍或无关常识不合格。"],
  ["install.eval.business-assertions", "断言检查报告内容、结构与引用", 6,
    "Y 当且仅当断言检查主题相关的实质结论、可识别的报告结构，以及一个或多个可审查的来源 URL/引用。" +
    "只检查 succeeded、任务提交回执、非空文本、字数或“报告”字样判 N。"],
  ["install.eval.negative-case", "真实负例暴露引用编造风险", 4,
    "Y 当且仅当 Eval 包含一个虚构且不可能有可靠来源的具体主题，并断言系统不得编造引用或写成看似有据的报告。" +
    "prompt 若直接教它标准拒答，或只把网络失败当负例，判 N。"],
  ["install.eval.robust-open-output", "开放报告使用稳健判断", 3,
    "Y 当且仅当对可有多种正确章节、结论与引用措辞的报告使用语义 Judge、解析后的 Markdown/引用 URL 结构检查或宽容 matcher。" +
    "仅匹配一个脆弱短语、完整原文或和业务无关的长度判 N。"],
  ["install.eval.no-service-management", "Eval 不代管目标服务", 2,
    "Y 当且仅当 Eval 只描述研究任务和断言，没有在 test 中自行启动、伪造、重启或代管 GPT Researcher 服务。" +
    "服务 setup/teardown 位于 Experiment/Plugin/Sandbox lifecycle 才判 Y。"],
  ["install.experiment.target-coupling", "使用本次 GPT Researcher Adapter 与目标 Eval", 5,
    "Y 当且仅当 Experiment 实际选择本次 GPT Researcher Adapter，且它选中的 Eval 测试的也是该研究系统，" +
    "而不是内置/通用/echo agent 或无关 Eval。必须能从导入和 experiment 选择追到同一对定义。"],
  ["install.experiment.config-consumed", "模型、flags 与静态配置不是死配置", 3,
    "Y 当且仅当 Experiment 中的 model、flags 或静态配置有清楚的消费方：Adapter/lifecycle 读取后传给 GPT Researcher。" +
    "配了值却没有任何读取点、只改显示名或被硬编码覆盖判 N。未选用 flags 不是错，但仍需证明实际声明的 model/配置被消费。"],
  ["install.experiment.service-start", "目标服务启动与就绪", 2,
    "Y 当且仅当 Experiment/Plugin/Sandbox lifecycle 负责启动真实 GPT Researcher，并等待GPT Researcher 的 WebSocket/HTTP 入口可用后才发送任务。仅假设外部已启动判 N。"],
  ["install.experiment.service-cleanup", "目标服务清理", 1,
    "Y 当且仅当 lifecycle 在结束或失败时可靠清理目标服务的进程或容器。"],
] as const;

/**
 * [key, label, points, rubric]：agent 写的 Eval 有没有 NiceEval Taste（随包 niceeval-taste.mdx 的自检清单）。
 * 每条可以独立缺失，各计 1 分。
 */
const TASTE_RUBRICS = [
  ["install.taste.readable", "正文读得出判据", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当只读 Eval 正文就能说出它测什么、每项什么算通过、分数或门槛怎么来；" +
    "关键阈值、数量和分值直接写在检查上，没有藏进辅助函数。"],
  ["install.taste.deterministic-facts", "事实用确定性检查", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当能直接读到的事实（工具名与参数、次数、文件内容、命令退出码、结构化字段）" +
    "用确定性检查，没有把这类事实交给 Judge 判断。"],
  ["install.taste.match-over-arithmetic", "判据写在 Match 上", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当能用现成 Match（equals、includes、pattern、toolMatch、countWhere 等）表达的判据，" +
    "没有先手算成布尔值或计数，再交给 isTrue 或 equals(true)。"],
  ["install.taste.unknown-stays-unknown", "未知保持未知", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当缺失的数据（缺记录、缺 token、解析失败）保留为不可判定或直接报错，" +
    "没有补成 0、false 或空字符串后继续判分。"],
  ["install.taste.stop-on-prerequisite", "前提失败即停", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当后续检查依赖的前提（如本轮成功、服务可达）不满足时，用 orStop 或等价方式停下，" +
    "不在前提已失败时继续给依赖它的项判分。没有这种依赖关系时判 Y。"],
] as const;

const FOLLOW_UP =
  "确认：选 Tier 1，首跑不接 OTel 或 LangSmith；目标模型沿用服务默认值，搜索使用内置 DuckDuckGo，不做 experiment flags；" +
  "可以自主运行、诊断、修复和重试，不限制格数、Attempt 数或运行轮次，无需再次申请运行授权；实际成本计入评估。这台机器可以联网，可以按 GPT Researcher 上游方式安装依赖或拉取镜像。" +
  "凭证仅从 /opt/fixture-secrets/target-app.env 注入目标服务进程，不得输出或复制进工作区。请按计划继续完成接入与验证。";

/** 只回答 request 实际问到的选择，不主动泄露实现答案。 */
function answerRequestedChoice(question: string): string {
  const answers: string[] = [];
  if (/tier|otel|otlp|trac|telemetry|langsmith|观测|追踪/i.test(question)) answers.push("选 Tier 1；首跑不接 OTel 或 LangSmith。");
  if (/model|judge|flag|variant|report.type|tone|source|search|retriev|tavily|duckduckgo|模型|裁判|变体|配置|搜索|检索/i.test(question)) {
    answers.push("目标模型沿用目标服务默认值，搜索使用内置 DuckDuckGo；没有可用 Judge key，不做 experiment flags。");
  }
  if (/budget|attempt|cost|time|预算|费用|时间|规模|并发/i.test(question)) answers.push("不限制格数、Attempt 数或运行轮次，可自主诊断、修复和重试，无需再次申请运行授权；实际成本计入评估。");
  if (/image|sandbox|docker|incus|镜像|沙箱|运行时/i.test(question)) {
    answers.push("这台机器可以联网，可以按上游方式安装依赖或拉取镜像。");
  }
  if (/credential|secret|key|token|凭证|密钥|令牌/i.test(question)) {
    answers.push("目标服务凭证在 /opt/fixture-secrets/target-app.env，只能注入目标服务进程，不得输出或复制进工作区。");
  }
  return answers.join("") || "这不是需要我决定的产品选择；请依据仓库与随包文档继续。";
}

export default defineScoreEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",

  timeoutMs: 80 * 60 * 1000,
  sandbox: sandboxRequirements({})
    .before(gitCheckout({
      id: "niceeval-eval.install-fixture.gpt-researcher-v3.6.0.checkout",
      repository: "https://github.com/assafelovic/gpt-researcher.git",
      ref: "5d84d2f5553e70a2765a8ff3a0d2672d60437ce8",
      to: ".",
      changeFrequency: 20,
    }))
    .before(command("rm", ["-rf", ".git"], {
      id: "niceeval-eval.install-fixture.gpt-researcher-v3.6.0.detach",
      changeFrequency: 21,
      dependsOn: [actionRef("niceeval-eval.install-fixture.gpt-researcher-v3.6.0.checkout")],
    })),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");
    assertPagesInCandidate(
      /docs-site\/zh\/(tutorials\/(write-send|connect-your-agent)|reference\/events)\.mdx/,
      version,
    );

    // 官网首页给用户复制的同一句 prompt（NiceEval apps/site/lib/content.ts），URL 换成候选 tag 下的 INIT.md。
    // INIT.md 让 agent 装 npm latest；评的是候选版本，所以只多一句版本要求。
    const firstTurn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\n` +
      `Use niceeval@${version} exactly.`,
    );

    try {
      // ── 文档与首轮理解 ──
      // Codex 适配器会截断过长的工具输出，完整 Turn 历史是 partial；这里只交完整的部分。
      const firstTurnFacts = {
        task: firstTurn.input,
        status: firstTurn.status,
        commands: firstTurn.toolCalls.map(({ name, input, status }) => ({ name, input, status })),
        inputRequests: firstTurn.events.flatMap((e) => e.type === "input.requested" ? [e.request] : []),
        reply: firstTurn.reply,
      };
      await t.group("文档与首轮理解", async () => {
        for (const [key, label, points, question] of FIRST_TURN_QUESTIONS) {
          t.judge(firstTurnFacts, yesNo(key, `只根据首轮的 commands、inputRequests 与 reply 回答：${question}`))
            .score(points).key(key).label(label);
        }
        firstTurn.toolOrder([
          toolMatch({ input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
          toolMatch({ input: referencesAnyPath([
            "node_modules/niceeval/docs-site/zh/tutorials/connect-your-agent.mdx",
            "node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx",
            "node_modules/niceeval/docs-site/zh/tutorials/quickstart.mdx",
            "node_modules/niceeval/docs-site/zh/reference/events.mdx",
          ]) }),
        ]).score(3).key("install.docs.index-to-relevant-page").label("从随包 INDEX 路由到相关页面");
      });

      const { inputRequests } = firstTurnFacts;

      // 只有 agent 真正提出 input.requested 时按问题作答；否则给一条最小确认。
      const handoff = firstTurn.status === "waiting" && inputRequests.length > 0
        ? await t.respond(...inputRequests.map((request) => ({
          request,
          text: answerRequestedChoice(JSON.stringify(request)),
        })))
        : await t.send(FOLLOW_UP);

      t.notCalledTool(toolMatch({
        input: referencesAnyPath([
          "niceeval.com/docs",
          "github.com/CorrectRoadH/niceeval/blob/main",
          "github.com/CorrectRoadH/niceeval/tree/main",
          "github.com/CorrectRoadH/niceeval/raw/main",
        ]),
      })).score(1).key("install.docs.no-online-main").label("没有退回 online main 文档");

      // ── 源码设计：先于所有安装与运行 gate 评审 ──
      const root = await locateInstallRoot(t.sandbox);
      const source = root === null ? "" : await readAuthoredSource(t.sandbox, root);
      await t.group("Adapter、Experiment 与 Eval 源码设计", async () => {
        for (const [key, label, points, rubric] of SOURCE_RUBRICS) {
          t.judge({ target: "GPT Researcher", authoredSource: source }, yesNo(key, rubric))
            .score(points).key(key).label(label);
        }
      });
      await t.group("Eval 判据可读性（NiceEval Taste）", async () => {
        for (const [key, label, points, rubric] of TASTE_RUBRICS) {
          t.judge({ authoredSource: source }, yesNo(key, rubric)).score(points).key(key).label(label);
        }
      });

      // ── 安装与 dry plan：零分 gate ──
      await t.check(root, isDefined<string | null>()).key("install.gate.config").label("gate · niceeval.config.ts 存在").orStop();
      const at = root!;

      const installed = await t.sandbox.runCommand(
        "node", ["-p", "require('./node_modules/niceeval/package.json').version"], { cwd: at },
      );
      await t.check(installed.stdout.trim(), equals(version))
        .key("install.gate.exact-version").label(`gate · 项目依赖精确为 niceeval@${version}`).orStop();

      const list = await runCandidateCli(t.sandbox, at, ["list"]);
      await t.check(list, commandSucceeded())
        .key("install.gate.cli-discovery").label("gate · 项目内 CLI discovery 成功").orStop();

      const dry = await runCandidateCli(t.sandbox, at, ["exp", "--dry", "--json"]);
      await t.check(dry, commandSucceeded())
        .key("install.gate.dry-command").label("gate · exp --dry --json 成功").orStop();
      const plan = parseJson(dry.stdout) as { matrix?: unknown[] } | null;
      await t.check(plan?.matrix, isDefined<unknown[] | undefined>())
        .key("install.gate.dry-matrix").label("gate · dry plan 提供 matrix").orStop();
      await t.check(plan!.matrix!.length, greaterThan(0))
        .key("install.gate.dry-plan").label("gate · dry plan 包含可运行的格子").orStop();

      // ── agent 自己的真实运行与公开证据 ──
      // 当前格的结果允许来自不同轮次；历史 Run 保留，不只挑最后一轮的第一条。
      const shell = (script: string) => t.sandbox.runShell(script, { cwd: at });
      const runs = (await query(shell, { kind: "run.list" })).runs;
      await t.check(runs.length, greaterThan(0)).gate().score(6)
        .key("install.evidence.real-run").label("agent 真实运行过自己的 Experiment").orStop();
      const project = (await query(shell, { kind: "project.get" })).project;
      const attempts: { experimentId: string; evalId: string; locator?: string; verdict?: string }[] = project.cells.flatMap(
        (cell: { experimentId: string; evalId: string; members: { verdict?: string; publication: { attemptLocator?: string; verdict?: string } }[] }) =>
          cell.members.map((member) => ({
            experimentId: cell.experimentId,
            evalId: cell.evalId,
            locator: member.publication.attemptLocator,
            verdict: member.verdict ?? member.publication.verdict,
          })),
      );
      await t.check(attempts.length, greaterThan(0))
        .key("install.gate.current-attempts").label("gate · 当前格包含 Attempt").orStop();
      await t.check(attempts.map((attempt) => attempt.locator), countWhere(isDefined(), equals(attempts.length)))
        .key("install.gate.published-attempt").label("gate · 当前格的所有 Attempt 均已发布").orStop();
      const evidence: { attempt: (typeof attempts)[number]; overview: string; execution: string }[] = [];
      const commandResults = [];
      for (const attempt of attempts) {
        const locator = attempt.locator!;
        const [overview, execution, sourceSlice] = await Promise.all([
          runCandidateCli(t.sandbox, at, ["show", locator]),
          runCandidateCli(t.sandbox, at, ["show", locator, "--execution"]),
          runCandidateCli(t.sandbox, at, ["show", locator, "--source"]),
        ]);
        commandResults.push(overview, execution, sourceSlice);
        evidence.push({ attempt, overview: overview.stdout, execution: execution.stdout });
      }
      await t.check(commandResults, countWhere(commandSucceeded(), equals(commandResults.length)))
        .key("install.gate.evidence-commands").label("gate · 所有当前 Attempt 的 overview/--execution/--source 都成功").orStop();

      await t.group("真实运行与公开证据", async () => {
        // 真实目标响应同时是替代物屏障：stub/mock/echo/进程内替代拿不到这一项，后续证据分随之停止。
        await t.judge({ authoredSource: source, attempts: evidence }, yesNo("install.evidence.target-response",
          "材料中的 authoredSource 是 agent 交接时的实际源码，attempts 是公开 CLI 读取的当前结果。结合源码核对 Adapter 到目标服务的请求和响应映射。" +
          "Y 当且仅当至少一个正向核心用例满足以下真实响应要求。其它当前结果若是预期负例，合法错误或拒答不因缺少正向业务内容而单独判 N。" +
          "execution 中的助手消息来自 GPT Researcher report 帧的 Adapter 映射，并呈现与 Eval 研究主题有关的实质报告内容与引用。" +
          "authoredSource 或 execution 显示用 stub/mock/fake/echo agent、临时协议桩或进程内函数替代真实 GPT Researcher 时判 N；" +
          "仅有静态文字、输入回显、启动日志或 status 判 N。"))
          .gate(YES).score(5).key("install.evidence.target-response").label("execution 含 GPT Researcher 的真实响应").orStop();
        t.judge({ authoredSource: source, attempts: evidence }, yesNo("install.evidence.source-explains-execution",
          "逐项审阅 attempts 数组中的所有当前结果，全部满足才判 Y。Y 当且仅当 authoredSource 中的 Adapter 与 Eval 能解释各 execution 中的输入、事件与断言结果，包括预期负例的拒答或合法错误。任一面空白或两者对不上判 N。"))
          .score(6).key("install.evidence.source-explains-execution").label("source 能解释 execution");
        t.check(attempts.map((attempt) => attempt.verdict), countWhere(or(equals("passed"), equals("failed")), equals(attempts.length)))
          .score(3).key("install.evidence.completed").label("Attempt 形成 passed 或 failed，而不是 errored");
        t.judge({ attempts, handoff: handoff.reply }, yesNo("install.evidence.handoff",
          "attempts 是 agent 各格的当前结果。Y 当且仅当最终回复给出这些结果的 locator 或覆盖它们的可复现查看命令，" +
          "说明主要文件，并与 attempts 的 verdict 一致地报告通过、失败或局限。漏 locator、只写泛化 show 命令、或把 failed/errored/替代物说成全绿判 N。"))
          .score(3).key("install.evidence.handoff").label("交接引用 locator 并如实报告");
        t.check(attempts.map((attempt) => attempt.verdict), countWhere(equals("passed"), equals(attempts.length)))
          .score(1).key("install.evidence.self-eval-passed").label("agent 自写 Eval passed（弱证据）");
      });
    } finally {
      await archiveAgentOutput(t, "gpt-researcher");
    }
  },
});

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
