/**
 * GPT Researcher install：候选 INIT.md + 随包文档能否把 coding agent 带到真实、可复审的 NiceEval 接入。
 *
 * 分数是 Adapter、Experiment、Eval、真实证据与首轮理解的自然价值累加，不设总分上限，
 * 也不为必要但无区分度的安装事实发分：精确版本、config、CLI discovery、一格一次 dry plan、
 * 交接 locator 和取证命令只做 gate。源码先评，安装或运行失败不会抹掉源码证据。
 */

import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, isDefined, referencesAnyPath, toolMatch } from "niceeval/expect";
import { actionRef, command, gitCheckout, sandboxRequirements } from "niceeval/sandbox";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";
import {
  archiveAgentOutput,
  findHandoffAttempt,
  locateInstallRoot,
  readAuthoredSource,
  runCandidateCli,
} from "../../../lib/install-probes.ts";
import { yesNo } from "../../../lib/judge.ts";

const GIB = 1024 ** 3;

/** [key, label, points, rubric]：只看首轮回复、终态与 HITL 请求。 */
const FIRST_TURN_RUBRICS = [
  ["install.interaction.interface", "核对接口", 4,
    "Y 当且仅当 agent 陈述它从仓库确认的 GPT Researcher 真实接口与能力边界：" +
    "主路径是 FastAPI /ws：客户端发送 `start ` + JSON，服务端依次返回 logs/images/report/path 帧；" +
    "REST 入口也不是 OpenAI Chat Completions 形状；核心能力是自主检索多源资料并生成带引用的结构化报告。" +
    "只说“调 API”或猜成 OpenAI messages 接口判 N。"],
  ["install.interaction.telemetry", "询问真正用户选择", 3,
    "Y 当且仅当 agent 在实作前询问会改变方案的 Tier，是否使用 LangSmith 或另接观测，" +
    "目标模型/搜索配置或 report_type/tone/report_source 变体，以及首跑 Attempt/时间/费用预算。" +
    "少了 Tier、观测、模型或预算中任一类判 N；并且必须在首轮明确暂停、把决定留给用户；" +
    "正式 HITL waiting 或普通文本请求确认都接受；反问本应从仓库查明的接口事实不算用户选择。"],
  ["install.interaction.scope.use-case", "首条 Eval 贴核心用例", 4,
    "Y 当且仅当 agent 主动提出一条具体的首个 Eval 核心用例，可观察的业务成功结果，以及主要失败风险。核心能力是：" +
    "对具体主题自主检索多源资料，产出带引用来源的结构化研究报告正文；" +
    "成功应检查主题相关实质内容、结构化章节和引用 URL；主要风险包括虚构主题被写成看似有据的报告。" +
    "仅提 hello、任务提交回执或非空回复判 N。仓库可确认的事实应由 agent 先提出，不应甩给用户。"],
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
  ["install.adapter.failure-semantics", "取消、超时与错误不被吞掉", 3,
    "Y 当且仅当 send 将 NiceEval AbortSignal 或等价取消机制传给 WebSocket/HTTP，有有界超时，" +
    "并在连接失败、非正常 close、帧解析错误、error 帧或未收到 report 时抛出/映射失败。catch 后改返成功空文本或吞错判 N。"],
  ["install.adapter.credential-boundary", "凭证边界正确", 2,
    "Y 当且仅当 LLM/搜索凭证只从环境/目标服务进程边界读取，不硬编码，不写入工作区，不打印，也不混入 Eval 文本或取证输出。"],
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
  ["install.experiment.lifecycle", "目标服务生命周期、环境与清理合理", 3,
    "Y 当且仅当 Experiment/Plugin/Sandbox lifecycle 负责启动真实 GPT Researcher、将 /opt/fixture-secrets/target-app.env 只注入目标服务进程、" +
    "等待 WebSocket/HTTP 可用，并在结束或失败时可靠清理进程/容器。仅假设外部已启动、把凭证 source 到 agent shell，或无清理判 N。"],
  ["install.experiment.first-run-scale", "首跑规模符合预算", 1,
    "Y 当且仅当可实际执行的首跑选择是一个 Experiment × 一条 Eval × 一次 Attempt，没有隐式矩阵扩张或多次 attempts。"],
] as const;

/** [key, label, points, rubric]：只看交接 locator 的 overview / --execution / --source。 */
const EVIDENCE_RUBRICS = [
  ["install.evidence.consistent-chain", "同一 locator 的 overview/execution/source 证据链一致", 6,
    "Y 当且仅当 overview、execution 与 source 显示同一 eval/experiment/agent/attempt，" +
    "且 source 中的 Adapter/Eval 能解释 execution 中的输入、事件与断言。任一面空白、对象不一致或无法交叉印证判 N。"],
  ["install.evidence.target-response", "execution 含 Adapter 映射的 GPT Researcher 真实报告", 5,
    "Y 当且仅当 execution 中的 ASSISTANT/message 内容能追溯到 GPT Researcher report 帧的 Adapter 映射，" +
    "并呈现与 Eval 研究主题有关的实质报告内容与引用。仅有静态 ASSISTANT 文字、输入回显、logs/path/status 或无法与 Adapter 映射对应的文本判 N。"],
] as const;

const FOLLOW_UP =
  "确认：选 Tier 1，首跑不接 OTel 或 LangSmith；目标模型与搜索配置沿用服务默认值，不做 experiment flags；" +
  "首跑只允许一格一次。Sandbox 可以访问互联网；cache.invalid/niceeval-install/runtime:python " +
  "只是预载的基础运行时，可以按 GPT Researcher 上游方式联网安装依赖或拉取固定版本镜像。" +
  "凭证仅从 /opt/fixture-secrets/target-app.env 注入目标服务进程，不得输出或复制进工作区。请按计划继续完成接入与验证。";

/** 只回答 request 实际问到的选择，不主动泄露实现答案。 */
function answerRequestedChoice(question: string): string {
  const answers: string[] = [];
  if (/tier|otel|otlp|trac|telemetry|langsmith|观测|追踪/i.test(question)) answers.push("选 Tier 1；首跑不接 OTel 或 LangSmith。");
  if (/model|judge|flag|variant|report.type|tone|source|模型|裁判|变体|配置/i.test(question)) {
    answers.push("目标模型与搜索配置沿用目标服务默认值；没有可用 Judge key，不做 experiment flags。");
  }
  if (/budget|attempt|cost|time|预算|费用|时间|规模|并发/i.test(question)) answers.push("首跑预算只允许一格一次。");
  if (/image|sandbox|docker|incus|镜像|沙箱|运行时/i.test(question)) {
    answers.push("Sandbox 可以访问互联网；cache.invalid/niceeval-install/runtime:python 只是预载基础运行时，可以按上游方式联网安装依赖或拉取固定版本镜像。");
  }
  if (/credential|secret|key|token|凭证|密钥|令牌/i.test(question)) {
    answers.push("目标服务凭证在 /opt/fixture-secrets/target-app.env，只能注入目标服务进程，不得输出或复制进工作区。");
  }
  return answers.join("") || "这不是需要我决定的产品选择；请依据仓库与随包文档继续。";
}

export default defineScoreEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",

  timeoutMs: 50 * 60 * 1000,
  sandbox: sandboxRequirements({
    docker: {
      api: "docker/v1",
      compose: "v2",
      isolation: "dedicated-kernel/v1",
      minimumDataBytes: 4 * GIB,
    },
  })
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

    const firstTurn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    try {
      // ── 文档与首轮理解 ──
      const firstTurnFacts = {
        task: firstTurn.input,
        status: firstTurn.status,
        reply: firstTurn.reply,
        inputRequests: firstTurn.events.flatMap((e) => e.type === "input.requested" ? [e.request] : []),
      };
      await t.group("文档与首轮理解", async () => {
        for (const [key, label, points, rubric] of FIRST_TURN_RUBRICS) {
          t.judge(firstTurnFacts, yesNo(key, `只判断 agent 写代码前的第一条回复。${rubric}`))
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

      // 只有 agent 真正提出 input.requested 时按问题作答；否则给一条最小确认。
      const handoff = firstTurn.status === "waiting" && firstTurnFacts.inputRequests.length > 0
        ? await t.respond(...firstTurnFacts.inputRequests.map((request) => ({
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

      // ── 安装与 dry plan：零分 gate ──
      await t.check(root, isDefined<string | null>()).key("install.gate.config").label("gate · niceeval.config.ts 存在").orStop();
      const at = root!;

      const installed = await t.sandbox.runCommand(
        "node", ["-p", "require('./node_modules/niceeval/package.json').version"], { cwd: at },
      );
      await t.check(installed.stdout.trim(), equals(version))
        .key("install.gate.exact-version").label(`gate · 项目依赖精确解析为 niceeval@${version}`).orStop();

      const list = await runCandidateCli(t.sandbox, at, ["list"]);
      await t.check(list, commandSucceeded())
        .key("install.gate.cli-discovery").label("gate · 项目内 CLI discovery 成功").orStop();

      const dry = await runCandidateCli(t.sandbox, at, ["exp", "--dry", "--json"]);
      const plan = parseJson(dry.stdout) as { matrix?: unknown[]; attempts?: number; total?: number; evals?: number; configs?: number } | null;
      await t.check(
        { cells: plan?.matrix?.length, attempts: plan?.attempts, total: plan?.total, evals: plan?.evals, configs: plan?.configs },
        equals({ cells: 1, attempts: 1, total: 1, evals: 1, configs: 1 }),
      ).key("install.gate.dry-plan").label("gate · exp --dry --json 恰好一格一次").orStop();

      // ── 交接引用的真实 Attempt 与公开证据 ──
      const attempt = await findHandoffAttempt(t.sandbox, at, handoff.reply);
      await t.check(attempt, isDefined<typeof attempt>())
        .key("install.gate.locator").label("gate · 交接引用的 Attempt locator 能被候选 query 解析").orStop();
      const { locator } = attempt!;
      const [overview, execution, sourceSlice] = await Promise.all([
        runCandidateCli(t.sandbox, at, ["show", locator]),
        runCandidateCli(t.sandbox, at, ["show", locator, "--execution"]),
        runCandidateCli(t.sandbox, at, ["show", locator, "--source"]),
      ]);
      await t.check(
        { overview: overview.exitCode, execution: execution.exitCode, source: sourceSlice.exitCode },
        equals({ overview: 0, execution: 0, source: 0 }),
      ).key("install.gate.evidence-commands").label(`gate · ${locator} 的 overview/--execution/--source 都成功`).orStop();

      const published = {
        target: "GPT Researcher",
        attempt,
        overview: overview.stdout,
        execution: execution.stdout,
        source: sourceSlice.stdout,
      };
      await t.judge(
        {
          ...published,
          assistantMessages: t.events.flatMap((e) => e.type === "message" && e.role === "assistant" ? [e.text] : []),
          authoredSource: source,
        },
        yesNo("install.gate.no-explicit-stand-in",
          "Y 当且仅当材料中没有明确证据显示 agent 用 stub/mock/fake/echo agent、临时协议桩或进程内函数替代真实目标服务完成验证。" +
          "只是提到“不会用 mock”、或 fixture 自带的 HTTP 服务不算替代；明确说用替代物跑通、源码里 echo adapter 或 stub model 判 N。"),
      ).gate(0.5).key("install.gate.no-explicit-stand-in").label("gate · 没有明确的替代物").orStop();

      await t.group("真实运行与公开证据", async () => {
        await t.judge(published, yesNo("install.evidence.real-published-attempt",
          "Y 当且仅当 overview/execution/source 交叉证明该 locator 属于本轮实际执行的 GPT Researcher Experiment，" +
          "发布了目标 GPT Researcher Eval 的 Attempt，且 source 和 execution 的 Adapter/Eval 身份一致。任意旧 locator、dry plan、通用 agent 或无法确认 Run membership 判 N。"))
          .gate(0.5).score(6).key("install.evidence.real-published-attempt").label("本轮真实非 dry Experiment 发布 Attempt").orStop();
        for (const [key, label, points, rubric] of EVIDENCE_RUBRICS) {
          t.judge(published, yesNo(key, rubric)).score(points).key(key).label(label);
        }
        t.check(attempt!.outcome, equals("completed"))
          .score(3).key("install.evidence.non-errored").label("Attempt 已完成而非 errored");
        t.judge({ attempt, overview: overview.stdout, handoff: handoff.reply }, yesNo("install.evidence.handoff",
          "Y 当且仅当最终回复明确引用 attempt.locator，提供可复现的 exp/show 命令和主要文件，" +
          "并与 attempt 的 outcome/verdict 一致地报告通过、失败、计分或局限。漏 locator、只写泛化 show 命令、或把 failed/errored/替代物说成全绿判 N。"))
          .score(3).key("install.evidence.handoff").label("交接引用 locator 并如实报告");
        t.check(attempt!.verdict, equals("passed"))
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
