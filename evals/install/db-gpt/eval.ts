/**
 * DB-GPT install：候选 INIT.md + 随包文档能否把 coding agent 带到真实、可复审的 NiceEval 接入。
 *
 * 分数是 Adapter、Experiment、Eval、真实证据与首轮理解的自然价值累加，不设总分上限，
 * 也不为必要但无区分度的安装事实发分：精确版本、config、CLI discovery、一格一次 dry plan、
 * 交接 locator 和取证命令只做 gate。源码先评，安装或运行失败不会抹掉源码证据。
 */

import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, isDefined, or, referencesAnyPath, toolMatch } from "niceeval/expect";
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

const GIB = 1024 ** 3;

/**
 * [key, label, points, question]：交给首轮 Turn 的完整历史（消息、工具调用与 HITL 请求）。
 * 每项只问一件可以独立缺失的事，报告里能直接看到缺的是哪一项。
 */
const FIRST_TURN_QUESTIONS = [
  ["install.first-turn.protocol", "核对接入协议", 2,
    "agent 是否说明了它从仓库确认的 DB-GPT 接入协议，并且本轮工具调用里能看到它读过对应源码或配置？" +
    "HTTP + JSON/SSE，默认端口 5670；OpenAI 兼容入口是 POST /api/v2/chat/completions，前端主聊天另走 /api/v1/chat/completions，没有 WebSocket。只说“调 API”、猜 WebSocket 或混淆两条路径判 N。"],
  ["install.first-turn.capability", "核对能力边界", 2,
    "agent 是否区分能访问数据源的 chat_data/chat_db_qa/chat_dashboard 与只调裸 LLM 的 chat_normal。"],
  ["install.first-turn.ask-tier", "询问 Tier 与观测", 1,
    "agent 是否在动手实现前询问了Tier 选择，以及是否复用 DB-GPT 现有 tracer/OTel/OTLP？"],
  ["install.first-turn.ask-model", "询问模型与变体", 1,
    "agent 是否在动手实现前询问了目标模型或实验变体？"],
  ["install.first-turn.ask-budget", "询问首跑预算", 1,
    "agent 是否在动手实现前询问了首跑的 Attempt 数、时间或费用预算？"],
  ["install.first-turn.pause", "首轮停下等用户决定", 1,
    "agent 是否在写代码前明确停下，把需要用户决定的选择留给用户？正式 HITL waiting 或普通文本请求确认都算；" +
    "只反问本应从仓库查明的接口事实不算。"],
  ["install.first-turn.use-case", "提出核心用例", 2,
    "agent 是否主动提出了一条具体的首个 Eval 核心用例：用户用自然语言问真实库表，DB-GPT 通过 chat_data / chat_db_qa / chat_dashboard 等模式生成 SQL、查询并分析。仅提 hello、HTTP 成功或非空回复判 N。"],
  ["install.first-turn.success", "说明成功判据", 1,
    "agent 是否说明了这条用例可观察的业务成功结果，例如核对具体数值、表名或 SQL？"],
  ["install.first-turn.risk", "指出主要风险", 1,
    "agent 是否指出了主要失败风险，例如对不存在的表/字段编造结果？"],
] as const;

/** [key, label, points, rubric]：只看 agent 写出的三件套源码。 */
const SOURCE_RUBRICS = [
  ["install.adapter.target-protocol", "真实 DB-GPT 协议与请求响应语义", 8,
    "Y 当且仅当 Adapter 连接 DB-GPT 仓库真实提供的 HTTP 入口，并对所选路径实现正确请求/响应语义：" +
    "例如 POST /api/v2/chat/completions 的兼容 payload 与 JSON/SSE 返回，或仓库中另一条被源码证明的 DB-GPT 路径及其实际 shape。" +
    "仅有通用 /v1/chat/completions、猜测 WebSocket、进程内函数调用或静态回复判 N。"],
  ["install.adapter.response-mapping", "真实响应映射为 NiceEval 消息或事件", 6,
    "Y 当且仅当 NiceEval 助手消息或标准事件的文本来自 DB-GPT 实际 JSON/SSE response/delta，" +
    "并正确组合流式分片和结束。返回输入原文、固定 ASSISTANT 文字、未读 body 或把 logs/status 当最终答案判 N。"],
  ["install.adapter.variables-forwarded", "模型、配置与实验变量传到 DB-GPT", 3,
    "Y 当且仅当 Adapter 真正读取 model 以及所选静态配置（如 base URL、chat_mode、chat_param），" +
    "并把它们传入 DB-GPT 请求或运行过程。只在 Experiment 声明但 send 不读取，或 send 内全部硬编码，判 N。"],
  ["install.adapter.cancel-timeout", "取消与超时", 1,
    "Y 当且仅当 send 把 NiceEval AbortSignal 或等价取消机制传给网络请求，并设置有界超时。"],
  ["install.adapter.error-propagation", "错误不被吞掉", 2,
    "Y 当且仅当在非 2xx、SSE/JSON 解析错误、连接中断或目标服务报错时抛出或映射为失败。catch 后改返成功空文本或吞错判 N。"],
  ["install.adapter.credential-boundary", "凭证边界正确", 2,
    "Y 当且仅当凭证只从环境/目标服务进程边界读取，不硬编码，不写入工作区，不打印，也不混入 Eval 文本或取证输出；" +
    "/opt/fixture-secrets/target-app.env 只注入目标服务进程，不 source 到 agent shell。"],
  ["install.eval.core-input", "输入覆盖 DB-GPT 核心能力", 6,
    "Y 当且仅当至少一条 Eval 输入让用户用自然语言问真实库表，DB-GPT 通过 chat_data / " +
    "chat_db_qa / chat_dashboard 等模式生成 SQL、查询并分析；chat_normal 只是裸 LLM 闲聊。" +
    "合格形状是：具体的数据问答或分析任务，并使用能触达数据库的模式及对应数据源参数；" +
    "chat_normal 下问常识或算术也没有触达 DB-GPT 的差异化能力。hello、自我介绍或无关常识不合格。"],
  ["install.eval.business-assertions", "断言检查具体业务结果", 6,
    "Y 当且仅当断言核对可预期的业务事实，例如查询数值、表/字段名、SQL 片段或与固定测试数据一致的分析结论。" +
    "只检查 succeeded、HTTP 2xx、非空文本、字数或“成功”字样判 N。"],
  ["install.eval.negative-case", "真实负例暴露编造风险", 4,
    "Y 当且仅当 Eval 询问固定测试数据中不存在的表或字段，并断言系统不得编造数值/SQL。" +
    "prompt 若直接教它标准拒答，或只把网络失败当负例，判 N。"],
  ["install.eval.robust-open-output", "开放输出使用稳健判断", 3,
    "Y 当且仅当对可有多种正确措辞的输出使用语义 Judge、解析后的结构/数值比较、或能容纳合法变体的 matcher。" +
    "仅匹配一个脆弱短语、完整原文或和业务无关的长度判 N。"],
  ["install.eval.no-service-management", "Eval 不代管目标服务", 2,
    "Y 当且仅当 Eval 只描述任务和断言，没有在 test 中自行启动、伪造、重启或代管 DB-GPT 服务。" +
    "服务 setup/teardown 位于 Experiment/Plugin/Sandbox lifecycle 才判 Y。"],
  ["install.experiment.target-coupling", "使用本次 DB-GPT Adapter 与目标 Eval", 5,
    "Y 当且仅当 Experiment 实际选择本次 DB-GPT Adapter，且它选中的 Eval 测试的也是 DB-GPT 数据问答，" +
    "而不是内置/通用/echo agent 或无关 Eval。必须能从导入和 experiment 选择追到同一对定义。"],
  ["install.experiment.config-consumed", "模型、flags 与静态配置不是死配置", 3,
    "Y 当且仅当 Experiment 中的 model、flags 或静态配置有清楚的消费方：Adapter/lifecycle 读取后传给 DB-GPT。" +
    "配了值却没有任何读取点、只改显示名或被硬编码覆盖判 N。未选用 flags 不是错，但仍需证明实际声明的 model/配置被消费。"],
  ["install.experiment.service-start", "目标服务启动与就绪", 2,
    "Y 当且仅当 Experiment/Plugin/Sandbox lifecycle 负责启动真实 DB-GPT，并等待DB-GPT 的 HTTP 入口可用后才发送任务。仅假设外部已启动判 N。"],
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
  "确认：选 Tier 1，首跑不接 OTel/OTLP；目标模型沿用服务默认配置，不做 experiment flags；" +
  "首跑只允许一格一次。这台机器可以联网，可以按 DB-GPT 上游方式安装依赖或拉取镜像。" +
  "凭证仅从 /opt/fixture-secrets/target-app.env 注入目标服务进程，不得输出或复制进工作区。请按计划继续完成接入与验证。";

/** 只回答 request 实际问到的选择，不主动泄露实现答案。 */
function answerRequestedChoice(question: string): string {
  const answers: string[] = [];
  if (/tier|otel|otlp|trac|telemetry|观测|追踪/i.test(question)) answers.push("选 Tier 1；首跑不接 OTel/OTLP。");
  if (/model|judge|flag|variant|模型|裁判|变体|配置/i.test(question)) {
    answers.push("目标模型沿用目标服务默认配置；没有可用 Judge key，不做 experiment flags。");
  }
  if (/budget|attempt|cost|time|预算|费用|时间|规模|并发/i.test(question)) answers.push("首跑预算只允许一格一次。");
  if (/image|sandbox|docker|incus|镜像|沙箱|运行时/i.test(question)) {
    answers.push("这台机器可以联网，可以按上游方式安装依赖或拉取镜像。");
  }
  if (/credential|secret|key|token|凭证|密钥|令牌/i.test(question)) {
    answers.push("目标服务凭证在 /opt/fixture-secrets/target-app.env，只能注入目标服务进程，不得输出或复制进工作区。");
  }
  return answers.join("") || "这不是需要我决定的产品选择；请依据仓库与随包文档继续。";
}

export default defineScoreEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",

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
      id: "niceeval-eval.install-fixture.db-gpt-v0.8.1.checkout",
      repository: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "177bfc84f77e7f7760c055a748b0e4bb82d9fa47",
      to: ".",
      sparse: { include: ["/*"], exclude: ["/docs/", "/assets/"] },
      changeFrequency: 20,
    }))
    .before(command("rm", ["-rf", ".git"], {
      id: "niceeval-eval.install-fixture.db-gpt-v0.8.1.detach",
      changeFrequency: 21,
      dependsOn: [actionRef("niceeval-eval.install-fixture.db-gpt-v0.8.1.checkout")],
    })),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");
    assertPagesInCandidate(
      /docs-site\/zh\/tutorials\/(connect-your-agent|write-send|quickstart)\.mdx/,
      version,
    );

    // 官网首页给用户复制的同一句 prompt（NiceEval apps/site/lib/content.ts），只把 URL 换成候选 tag 下的 INIT.md。
    const firstTurn = await t.send(`READ ${candidateInitDocUrl(version)} and install niceeval for this repo.`);

    try {
      // ── 文档与首轮理解 ──
      await t.group("文档与首轮理解", async () => {
        for (const [key, label, points, question] of FIRST_TURN_QUESTIONS) {
          firstTurn.closeQA(question, { maxMaterialBytes: 2 * 1024 * 1024, maxAuditBytes: 4 * 1024 * 1024 })
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

      const inputRequests = firstTurn.events.flatMap((e) => e.type === "input.requested" ? [e.request] : []);

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
          t.judge({ target: "DB-GPT", authoredSource: source }, yesNo(key, rubric))
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
        .key("install.gate.exact-version").label(`gate · 项目依赖是当前 npm latest（niceeval@${version}）`).orStop();

      const list = await runCandidateCli(t.sandbox, at, ["list"]);
      await t.check(list, commandSucceeded())
        .key("install.gate.cli-discovery").label("gate · 项目内 CLI discovery 成功").orStop();

      const dry = await runCandidateCli(t.sandbox, at, ["exp", "--dry", "--json"]);
      const plan = parseJson(dry.stdout) as { matrix?: unknown[]; attempts?: number; total?: number; evals?: number; configs?: number } | null;
      await t.check(
        { cells: plan?.matrix?.length, attempts: plan?.attempts, total: plan?.total, evals: plan?.evals, configs: plan?.configs },
        equals({ cells: 1, attempts: 1, total: 1, evals: 1, configs: 1 }),
      ).key("install.gate.dry-plan").label("gate · exp --dry --json 恰好一格一次").orStop();

      // ── agent 自己的真实运行与公开证据 ──
      // 被测项目没有预置 Record：这里的每个 Run 都是 agent 本次自己跑的，取最后一个。
      const shell = (script: string) => t.sandbox.runShell(script, { cwd: at });
      const runs: { runId: string; experimentId: string; startedAt: string }[] = (await query(shell, { kind: "run.list" }))?.runs ?? [];
      const lastRun = runs.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).at(-1);
      await t.check(lastRun, isDefined<typeof lastRun>()).gate().score(6)
        .key("install.evidence.real-run").label("agent 真实运行过自己的 Experiment").orStop();
      const planned: { evalId: string; locator?: string; verdict?: string }[] =
        (await query(shell, { kind: "run.get", runId: lastRun!.runId })).run.plannedAttempts;
      const published = planned.find((a) => a.locator !== undefined);
      await t.check(published, isDefined<typeof published>())
        .key("install.gate.published-attempt").label("gate · 最后一次运行发布了 Attempt").orStop();
      const attempt = { experimentId: lastRun!.experimentId, evalId: published!.evalId, locator: published!.locator!, verdict: published!.verdict ?? null };
      const { locator } = attempt;
      const [overview, execution, sourceSlice] = await Promise.all([
        runCandidateCli(t.sandbox, at, ["show", locator]),
        runCandidateCli(t.sandbox, at, ["show", locator, "--execution"]),
        runCandidateCli(t.sandbox, at, ["show", locator, "--source"]),
      ]);
      await t.check(
        { overview: overview.exitCode, execution: execution.exitCode, source: sourceSlice.exitCode },
        equals({ overview: 0, execution: 0, source: 0 }),
      ).key("install.gate.evidence-commands").label(`gate · ${locator} 的 overview/--execution/--source 都成功`).orStop();

      const evidence = {
        attempt,
        overview: overview.stdout,
        execution: execution.stdout,
        source: sourceSlice.stdout,
      };
      await t.group("真实运行与公开证据", async () => {
        // 真实目标响应同时是替代物屏障：stub/mock/echo/进程内替代拿不到这一项，后续证据分随之停止。
        await t.judge(evidence, yesNo("install.evidence.target-response",
          "Y 当且仅当execution 中的助手消息来自 DB-GPT 真实 JSON/SSE 响应的 Adapter 解析，并呈现与 Eval 数据问答有关的具体结果。" +
          "source 或 execution 显示用 stub/mock/fake/echo agent、临时协议桩或进程内函数替代真实 DB-GPT 时判 N；" +
          "仅有静态文字、输入回显、启动日志或 status 判 N。"))
          .gate(YES).score(5).key("install.evidence.target-response").label("execution 含 DB-GPT 的真实响应").orStop();
        t.judge(evidence, yesNo("install.evidence.source-explains-execution",
          "Y 当且仅当 source 中的 Adapter 与 Eval 能解释 execution 中的输入、事件与断言结果。任一面空白或两者对不上判 N。"))
          .score(6).key("install.evidence.source-explains-execution").label("source 能解释 execution");
        t.check(attempt.verdict, or(equals("passed"), equals("failed")))
          .score(3).key("install.evidence.completed").label("Attempt 形成 passed 或 failed，而不是 errored");
        t.judge({ attempt, handoff: handoff.reply }, yesNo("install.evidence.handoff",
          "attempt 是 agent 最后一次真实运行的结果。Y 当且仅当最终回复给出这次运行的 locator 或等价的可复现查看命令，" +
          "说明主要文件，并与 attempt 的 verdict 一致地报告通过、失败或局限。漏 locator、只写泛化 show 命令、或把 failed/errored/替代物说成全绿判 N。"))
          .score(3).key("install.evidence.handoff").label("交接引用 locator 并如实报告");
        t.check(attempt.verdict, equals("passed"))
          .score(1).key("install.evidence.self-eval-passed").label("agent 自写 Eval passed（弱证据）");
      });
    } finally {
      await archiveAgentOutput(t, "db-gpt");
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
