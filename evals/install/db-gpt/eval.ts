/**
 * DB-GPT install 正式评估入口。
 *
 * 这道题评的是候选 INIT.md + 随包文档能否把 coding agent 带到真实、
 * 可复审的 NiceEval 接入。分数按 Adapter、Experiment、Eval、真实证据与首轮理解
 * 的自然价值加总，不设人工总分上限，也不为必要但无区分度的安装事实发分。
 *
 * 精确版本、config、CLI discovery、一格一次 dry plan、locator 和取证命令只做 gate。
 * 明确 stub/mock/echo/进程内替代会阻断真实性路径，「没发现」不得分。所有可独立
 * 审查的 Adapter、Experiment 与 Eval 源码先评，运行失败不会抹掉源码证据。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineScoreEval, type ScoreTestContext } from "niceeval";
import { closedQA, isTrue, referencesAnyPath, toolMatch } from "niceeval/expect";
import {
  actionRef,
  command,
  gitCheckout,
  sandboxRequirements,
} from "niceeval/sandbox";
import { assertPagesInCandidate, candidateInitDocUrl } from "../../../lib/candidate.ts";

const GIB = 1024 ** 3;

type Turn = Awaited<ReturnType<ScoreTestContext["send"]>>;

export default defineScoreEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  judge: true,
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
      /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/,
      version,
    );

    const firstTurn = await t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\n` +
      `This machine must end up with niceeval@${version} exactly — not whatever version is latest.`,
    );

    try {
      await scoreFirstTurn(t, firstTurn);
      const handoff = await continueWithMinimalAnswer(t, firstTurn);
      await scoreDocumentationRouting(t, firstTurn);

      const discoveredRoot = await locateInstallRoot(t.sandbox);
      const sourceRoot = discoveredRoot ?? ".";
      const authoredSource = await readAuthoredSource(t.sandbox, sourceRoot);
      const published = await collectPublishedEvidence(t, sourceRoot, handoff.message);

      await scoreSourceQuality(t, authoredSource);
      const assistantMessages = t.events.flatMap((event) =>
        event.type === "message" && event.role === "assistant" ? [event.text] : []
      );
      await assertFoundationGates(t, version, discoveredRoot);
      await blockExplicitStandIn(t, hasExplicitStandIn([
        ...assistantMessages,
        authoredSource,
        published?.execution.stdout ?? "",
        published?.source.stdout ?? "",
      ]));

      await scorePublishedEvidence(t, handoff, published);
    } finally {
      await archiveAgentOutput(t, "db-gpt");
    }
  },
});

// ── 文档与首轮理解 ──────────────────────────────────────────────────────

async function scoreFirstTurn(t: ScoreTestContext, turn: Turn): Promise<void> {
  await t.group("文档与首轮理解", async () => {
    const clarificationRubrics = [
      [
        "interface",
        "核对接口",
        4,
        "Y 当且仅当 agent 陈述它从仓库确认的 DB-GPT 真实接口与能力边界：" +
          "HTTP + JSON/SSE，默认端口 5670；OpenAI Chat Completions 兼容入口是 " +
          "POST /api/v2/chat/completions，前端主聊天另走 /api/v1/chat/completions，没有 WebSocket；" +
          "并区分能访问数据源的 chat_data/chat_db_qa/chat_dashboard 与裸 LLM 的 chat_normal。" +
          "只说“调 API”、猜 WebSocket 或混淆两条路径判 N。",
      ],
      [
        "telemetry",
        "询问真正用户选择",
        3,
        "Y 当且仅当 agent 在实作前询问会改变方案的 Tier，是否复用 DB-GPT 现有 tracer/OTel/OTLP，" +
          "目标模型或实验变体，以及首跑 Attempt/时间/费用预算。少了 Tier、观测、模型或预算中任一类判 N；" +
          "并且必须在首轮明确暂停、把决定留给用户；正式 HITL waiting 或普通文本请求确认都接受；" +
          "反问本应从仓库查明的接口事实不算用户选择。",
      ],
    ] as const;
    for (const [key, label, points, criteria] of clarificationRubrics) {
      turn.check(
        { input: turn.input, output: `turn.status=${turn.status}\n${turn.message}` },
        closedQA(`只判断 agent 写代码前的第一条回复是否做到【${label}】。${criteria} 不要因为其它维度缺失而判 N。`),
      ).score(points).key(`install.interaction.${key}`).label(label);
    }

    const scopeRubrics = [
      [
        "use-case",
        "首条 Eval 贴核心用例",
        4,
        "Y 当且仅当 agent 主动提出一条具体的首个 Eval 核心用例，可观察的业务成功结果，以及主要失败风险。核心能力是：" +
          "用户用自然语言问真实库表，DB-GPT 通过 chat_data / chat_db_qa / chat_dashboard 等模式生成 SQL、" +
          "查询并分析；成功应核对具体数值、表名或 SQL；主要风险包括对不存在的表/字段编造结果。" +
          "仅提 hello、HTTP 成功或非空回复判 N。",
      ],
    ] as const;
    for (const [key, label, points, criteria] of scopeRubrics) {
      turn.check(
        { input: turn.input, output: turn.message },
        closedQA(`只判断第一条回复是否做到【${label}】。${criteria} 仓库可确认的事实应由 agent 先提出，不应甩给用户。`),
      ).score(points).key(`install.interaction.scope.${key}`).label(label);
    }
  });
}

async function continueWithMinimalAnswer(t: ScoreTestContext, turn: Turn): Promise<Turn> {
  const requests = turn.events.flatMap((event) =>
    event.type === "input.requested" ? [event.request] : []
  );
  if (turn.status === "waiting" && requests.length > 0) {
    return t.respond(...requests.map((request) => ({
      request,
      text: answerRequestedChoice(JSON.stringify(request)),
    })));
  }
  return t.send(
    "确认：选 Tier 1，首跑不接 OTel/OTLP；目标模型沿用服务默认配置，不做 experiment flags；" +
    "首跑只允许一格一次。Sandbox 可以访问互联网；cache.invalid/niceeval-install/runtime:python " +
    "只是预载的基础运行时，可以按 DB-GPT 上游方式联网安装依赖或拉取固定版本镜像。" +
    "凭证仅从 /opt/fixture-secrets/target-app.env 注入目标服务进程，不得输出或复制进工作区。请按计划继续完成接入与验证。",
  );
}

function answerRequestedChoice(question: string): string {
  const answers: string[] = [];
  if (/tier|otel|otlp|trac|telemetry|观测|追踪/i.test(question)) answers.push("选 Tier 1；首跑不接 OTel/OTLP。");
  if (/model|judge|flag|variant|模型|裁判|变体|配置/i.test(question)) {
    answers.push("目标模型沿用目标服务默认配置；没有可用 Judge key，不做 experiment flags。");
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


// ── 随包文档路由 ────────────────────────────────────────────────────────

async function scoreDocumentationRouting(t: ScoreTestContext, firstTurn: Turn): Promise<void> {
  await t.group("随包文档路由", async () => {
    firstTurn.toolOrder([
      toolMatch({ input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
      toolMatch({ input: referencesAnyPath([
        "node_modules/niceeval/docs-site/zh/tutorials/connect-your-agent.mdx",
        "node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx",
        "node_modules/niceeval/docs-site/zh/tutorials/quickstart.mdx",
        "node_modules/niceeval/docs-site/zh/reference/events.mdx",
      ]) }),
    ]).score(3).key("install.docs.index-to-relevant-page").label("从随包 INDEX 路由到相关页面");
    t.notCalledTool(toolMatch({
      input: referencesAnyPath([
        "niceeval.com/docs",
        "github.com/CorrectRoadH/niceeval/blob/main",
        "github.com/CorrectRoadH/niceeval/tree/main",
        "github.com/CorrectRoadH/niceeval/raw/main",
      ]),
    })).score(1).key("install.docs.no-online-main").label("没有退回 online main 文档");
  });
}

// ── 安装与 dry plan 零分 gate ───────────────────────────────────────────

interface ExpPlan {
  matrix?: unknown[];
  attempts?: number;
  total?: number;
  evals?: number;
  configs?: number;
}

async function assertFoundationGates(
  t: ScoreTestContext,
  version: string,
  root: string | null,
): Promise<string> {
  await t.check(root !== null, isTrue("niceeval.config.ts 存在"))
    .key("install.gate.config")
    .label("gate · niceeval.config.ts 存在")
    .orStop();
  if (root === null) throw new Error("config barrier 没有终止评分");

  const installed = await t.sandbox.runCommand(
    "node",
    ["-p", "require('./node_modules/niceeval/package.json').version"],
    { cwd: root },
  );
  await t.check(
    installed.exitCode === 0 && installed.stdout.trim() === version,
    isTrue(`项目依赖必须精确解析为 niceeval@${version}`),
  ).key("install.gate.exact-version").label("gate · 精确候选版本").orStop();

  const list = await runCandidateCli(t.sandbox, root, ["list"]);
  await t.check(
    list.exitCode === 0 && hasDiscoveredEval(list.stdout),
    isTrue("候选版本的项目内 CLI 能发现至少一条 Eval"),
  ).key("install.gate.cli-discovery").label("gate · 项目内 CLI discovery").orStop();

  const dry = await runCandidateCli(t.sandbox, root, ["exp", "--dry", "--json"]);
  const dryPlan = parseExpPlan(dry.stdout);
  await t.check(
    dry.exitCode === 0 && isSingleAttemptPlan(dryPlan),
    isTrue("exp --dry --json 必须成功规划恰好一格一次；缺少物理 planning 镜像时不伪造 provider"),
  ).key("install.gate.dry-plan").label("gate · Experiment dry plan 一格一次").orStop();

  return root;
}

// ── 本轮 Attempt 的真实运行与公开证据 ────────────────────────────────────

type CommandEvidence = Awaited<ReturnType<ScoreTestContext["sandbox"]["runCommand"]>>;

interface PublishedEvidence {
  locator: string;
  overview: CommandEvidence;
  execution: CommandEvidence;
  source: CommandEvidence;
}

async function collectPublishedEvidence(
  t: ScoreTestContext,
  root: string,
  handoff: string,
): Promise<PublishedEvidence | null> {
  const selected = await selectPublishedAttempt(t, root, handoff);
  if (selected === null) return null;
  const execution = await runCandidateCli(t.sandbox, root, ["show", selected.locator, "--execution"]);
  const source = await runCandidateCli(t.sandbox, root, ["show", selected.locator, "--source"]);
  return { ...selected, execution, source };
}

async function scorePublishedEvidence(
  t: ScoreTestContext,
  handoff: Turn,
  published: PublishedEvidence | null,
): Promise<void> {
  await t.check(
    published !== null,
    isTrue("最终交接明确引用的 Attempt locator 能被项目内 CLI 解析；不从 bare show 猜旧结果"),
  ).key("install.gate.locator").label("gate · 交接 locator 可解析").orStop();
  if (published === null) throw new Error("locator barrier 没有终止评分");

  await t.check(
    published.overview.exitCode === 0 && published.execution.exitCode === 0 && published.source.exitCode === 0,
    isTrue(`同一 ${published.locator} 的 overview、--execution 与 --source 命令都实际成功`),
  ).key("install.gate.evidence-commands").label("gate · 取证命令实际成功").orStop();

  const status = parseAttemptStatus(published.overview.stdout);
  const evidenceMaterial = {
    input:
      `评审交接明确引用的固定 Attempt ${published.locator}。\n` +
      `--- overview ---\n${published.overview.stdout}\n` +
      `--- execution ---\n${published.execution.stdout}`,
    output: `--- source ---\n${published.source.stdout}`,
  };
  await t.group("真实运行与公开证据", async () => {
    await t.check(evidenceMaterial, closedQA(
      "【本轮非 dry Experiment membership】Y 当且仅当 overview/execution/source 交叉证明该 locator 属于本轮实际执行的 DB-GPT Experiment，" +
        "发布了目标 DB-GPT Eval 的 Attempt，且 source 和 execution 的 Adapter/Eval 身份一致。任意旧 locator、dry plan、通用 agent 或无法确认 Run membership 判 N。",
    ).atLeast(1)).score(6).key("install.evidence.real-published-attempt")
      .label("本轮真实非 dry Experiment 发布 Attempt").orStop();
    t.check(evidenceMaterial, closedQA(
      "【同一 locator 证据链】Y 当且仅当 overview、execution 与 source 显示同一 eval/experiment/agent/attempt，" +
        "且 source 中的 Adapter/Eval 能解释 execution 中的输入、事件与断言。任一面空白、对象不一致或无法交叉印证判 N。",
    )).score(6).key("install.evidence.consistent-chain").label("同一 locator 的 overview/execution/source 证据链一致");
    t.check(evidenceMaterial, closedQA(
      "【目标响应在 execution】Y 当且仅当 execution 中的 ASSISTANT/message 内容能追溯到 DB-GPT 响应解析，并呈现与 Eval 数据问答有关的具体结果。" +
        "仅有静态 ASSISTANT 文字、输入回显、启动日志/status 或无法与 Adapter 映射对应的文本判 N。",
    )).score(5).key("install.evidence.target-response").label("execution 含 Adapter 映射的 DB-GPT 真实响应");
    t.check(
      status === "passed" || status === "failed" || status === "scored",
      isTrue(`Attempt 得到非 errored 的已完成结果（实际：${status ?? "无法识别"}）`),
    ).score(3).key("install.evidence.non-errored").label("Attempt 非 errored 且已完成");
    handoff.check(
      {
        input: `交接对应的真实 locator 是 ${published.locator}，终态是 ${status ?? "无法识别"}。\n${published.overview.stdout}`,
        output: handoff.message,
      },
      closedQA(
        "【最终交接】Y 当且仅当最终回复明确引用输入中的真实 locator，提供可复现的 exp/show 命令和主要文件，" +
          "并与 overview 终态一致地报告通过、失败、计分或局限。漏 locator、只写泛化 show 命令、或把 failed/errored/替代物说成全绿判 N。",
      ),
    ).score(3).key("install.evidence.handoff").label("交接引用 locator 并如实报告");
    t.check(status === "passed", isTrue("候选 agent 自写 Eval 的 verdict 为 passed"))
      .score(1).key("install.evidence.self-eval-passed").label("agent 自写 Eval passed（弱证据）");
  });
}

// ── 先于真实性与运行 gate 审查的源码设计 ─────────────────────────────────

async function scoreSourceQuality(
  t: ScoreTestContext,
  source: string,
): Promise<void> {
  const material = {
    input: "下面是 agent 为 DB-GPT 写出的 NiceEval 三件套源码。",
    output: source || "（无）",
  };
  await t.group("Adapter、Experiment 与 Eval 源码设计", async () => {
    t.check(
      material,
      closedQA(
        "【真实目标协议】Y 当且仅当 Adapter 连接 DB-GPT 仓库真实提供的 HTTP 入口，并对所选路径实现正确请求/响应语义：" +
          "例如 POST /api/v2/chat/completions 的兼容 payload 与 JSON/SSE 返回，或仓库中另一条被源码证明的 DB-GPT 路径及其实际 shape。" +
          "仅有通用 /v1/chat/completions、猜测 WebSocket、进程内函数调用或静态回复判 N。",
      ),
    ).score(8).key("install.adapter.target-protocol").label("真实 DB-GPT 协议与请求响应语义");
    t.check(
      material,
      closedQA(
        "【真实响应映射】Y 当且仅当 NiceEval 助手消息或标准事件的文本来自 DB-GPT 实际 JSON/SSE response/delta，" +
          "并正确组合流式分片和结束。返回输入原文、固定 ASSISTANT 文字、未读 body 或把 logs/status 当最终答案判 N。",
      ),
    ).score(6).key("install.adapter.response-mapping").label("真实响应映射为 NiceEval 消息或事件");
    t.check(material, closedQA(
      "【变量传递】Y 当且仅当 Adapter 真正读取 model 以及所选静态配置（如 base URL、chat_mode、chat_param），" +
        "并把它们传入 DB-GPT 请求或运行过程。只在 Experiment 声明但 send 不读取，或 send 内全部硬编码，判 N。",
    )).score(3).key("install.adapter.variables-forwarded").label("模型、配置与实验变量传到 DB-GPT");
    t.check(material, closedQA(
      "【取消与失败】Y 当且仅当 send 将 NiceEval AbortSignal 或等价取消机制传给网络请求，有有界超时，" +
        "并在非 2xx、SSE/JSON 解析错误、连接中断或目标服务报错时抛出/映射失败。catch 后改返成功空文本或吞错判 N。",
    )).score(3).key("install.adapter.failure-semantics").label("取消、超时与错误不被吞掉");
    t.check(material, closedQA(
      "【凭证边界】Y 当且仅当凭证只从环境/目标服务进程边界读取，不硬编码，不写入工作区，不打印，也不混入 Eval 文本或取证输出。",
    )).score(2).key("install.adapter.credential-boundary").label("凭证边界正确");
    t.check(
      material,
      closedQA(
        "【核心能力输入】Y 当且仅当至少一条 Eval 输入让用户用自然语言问真实库表，DB-GPT 通过 chat_data / " +
          "chat_db_qa / chat_dashboard 等模式生成 SQL、查询并分析；chat_normal 只是裸 LLM 闲聊。" +
          "合格形状是：具体的数据问答或分析任务，并使用能触达数据库的模式及对应数据源参数；" +
          "chat_normal 下问常识或算术也没有触达 DB-GPT 的差异化能力。" +
          "hello、自我介绍或无关常识不合格。",
      ),
    ).score(6).key("install.eval.core-input").label("输入覆盖 DB-GPT 核心能力");
    t.check(
      material,
      closedQA(
        "【业务结果断言】Y 当且仅当断言核对可预期的业务事实，例如查询数值、表/字段名、SQL 片段或与固定测试数据一致的分析结论。" +
          "只检查 succeeded、HTTP 2xx、非空文本、字数或“成功”字样判 N。",
      ),
    ).score(6).key("install.eval.business-assertions").label("断言检查具体业务结果");
    t.check(
      material,
      closedQA(
        "【真实负例】Y 当且仅当 Eval 询问固定测试数据中不存在的表或字段，并断言系统不得编造数值/SQL。" +
          "prompt 若直接教它标准拒答，或只把网络失败当负例，判 N。",
      ),
    ).score(4).key("install.eval.negative-case").label("真实负例暴露编造风险");
    t.check(material, closedQA(
      "【开放输出稳健性】Y 当且仅当对可有多种正确措辞的输出使用语义 Judge、解析后的结构/数值比较、或能容纳合法变体的 matcher。" +
        "仅匹配一个脆弱短语、完整原文或和业务无关的长度判 N。",
    )).score(3).key("install.eval.robust-open-output").label("开放输出使用稳健判断");
    t.check(material, closedQA(
      "【Eval 生命周期边界】Y 当且仅当 Eval 只描述任务和断言，没有在 test 中自行启动、伪造、重启或代管 DB-GPT 服务。" +
        "服务 setup/teardown 位于 Experiment/Plugin/Sandbox lifecycle 才判 Y。",
    )).score(2).key("install.eval.no-service-management").label("Eval 不代管目标服务");
    t.check(
      material,
      closedQA(
        "【目标耦合】Y 当且仅当 Experiment 实际选择本次 DB-GPT Adapter，且它选中的 Eval 测试的也是 DB-GPT 数据问答，" +
          "而不是内置/通用/echo agent 或无关 Eval。必须能从导入和 experiment 选择追到同一对定义。",
      ),
    ).score(5).key("install.experiment.target-coupling").label("使用本次 DB-GPT Adapter 与目标 Eval");
    t.check(material, closedQA(
      "【配置被消费】Y 当且仅当 Experiment 中的 model、flags 或静态配置有清楚的消费方：Adapter/lifecycle 读取后传给 DB-GPT。" +
        "配了值却没有任何读取点、只改显示名或被硬编码覆盖判 N。未选用 flags 不是错，但仍需证明实际声明的 model/配置被消费。",
    )).score(3).key("install.experiment.config-consumed").label("模型、flags 与静态配置不是死配置");
    t.check(material, closedQA(
      "【服务生命周期】Y 当且仅当 Experiment/Plugin/Sandbox lifecycle 负责启动真实 DB-GPT、将 /opt/fixture-secrets/target-app.env 只注入目标服务进程、" +
        "等待可用，并在结束或失败时可靠清理进程/容器。仅假设外部已启动、把凭证 source 到 agent shell，或无清理判 N。",
    )).score(3).key("install.experiment.lifecycle").label("目标服务生命周期、环境与清理合理");
    t.check(material, closedQA(
      "【首跑规模】Y 当且仅当可实际执行的首跑选择是一个 Experiment × 一条 Eval × 一次 Attempt，没有隐式矩阵扩张或多次 attempts。",
    )).score(1).key("install.experiment.first-run-scale").label("首跑规模符合预算");
  });
}

async function blockExplicitStandIn(t: ScoreTestContext, explicit: boolean): Promise<void> {
  await t.check(
    !explicit,
    isTrue("源码、execution 或交接明确显示 stub/mock/echo/进程内替代时，阻断依赖真实运行的后续证据分"),
  ).key("install.gate.no-explicit-stand-in").label("gate · 明确替代物阻断真实证据路径").orStop();
}

// ── 纯取证与解析工具 ─────────────────────────────────────────────────────────

const LEGACY_OR_MODERN_LOCATOR =
  /(?<![A-Za-z0-9])(?:@[0-9A-HJKMNP-TV-Z]{13}|@[a-z0-9]{8})(?![A-Za-z0-9])/g;

function extractAttemptLocators(text: string): string[] {
  return text.match(LEGACY_OR_MODERN_LOCATOR) ?? [];
}

function assertLocatorParserContracts(): void {
  const fixtures: Array<[string, string, string]> = [
    ["0.11", "NEXT: niceeval show @1qm49emb; docs say @<locator>", "@1qm49emb"],
    ["0.12", "errored @1QVNFTAZ3WKWD, then Inspect @17X0SFT3GH9XH.", "@17X0SFT3GH9XH"],
    ["canary", "first @1SWKVJ2MAEQC7 / final (@10N88TXSS5WG2)", "@10N88TXSS5WG2"],
    ["placeholder", "niceeval show @<locator>", ""],
  ];
  for (const [version, text, expected] of fixtures) {
    const actual = extractAttemptLocators(text).at(-1) ?? "";
    if (actual !== expected) {
      throw new Error(`install locator parser contract ${version} 失败：期望 ${expected || "无"}，实际 ${actual || "无"}`);
    }
  }
}

assertLocatorParserContracts();

async function selectPublishedAttempt(
  t: ScoreTestContext,
  root: string,
  handoff: string,
): Promise<Pick<PublishedEvidence, "locator" | "overview"> | null> {
  const explicit = [...extractAttemptLocators(handoff)].reverse();
  for (const locator of explicit) {
    const overview = await runCandidateCli(t.sandbox, root, ["show", locator]);
    if (overview.exitCode === 0) return { locator, overview };
  }
  return null;
}

function parseAttemptStatus(stdout: string): "passed" | "failed" | "scored" | "errored" | null {
  const header = stdout.split("\n").slice(0, 16).join("\n");
  return /\berrored\b/i.test(header)
    ? "errored"
    : /\bscored\b/i.test(header)
      ? "scored"
      : /\bfailed\b/i.test(header)
        ? "failed"
        : /\bpassed\b/i.test(header)
          ? "passed"
          : null;
}

function hasExplicitStandIn(materials: readonly string[]): boolean {
  const positiveUse =
    /\b(?:verified|ran|run|running|passed|green|proved?|used?|using)\b[^.\n]{0,180}\b(?:with|against|via|through)?\s*(?:a\s+)?(?:temporary\s+|transient\s+|local\s+|protocol\s+|throwaway\s+|harness[- ]only\s+)*(?:stub|mock(?:ed)?|fake|stand[- ]?in)\b/i;
  const explicitModel = /\b(?:stub|mock|fake)[-_ ]?model\b/i;
  const chineseUse = /(?:用|使用|通过|跑了|跑过|验证)[^。\n]{0,100}(?:临时|本地|协议|一次性)?[^。\n]{0,20}(?:桩|模拟|假|占位)(?:服务|服务器|模型)/i;
  const serverWithMarker =
    /(?:http\.createServer|server\.listen)[\s\S]{0,240}\b(?:stub|mock|fake|stand[- ]?in)\b|\b(?:stub|mock|fake|stand[- ]?in)\b[\s\S]{0,240}(?:http\.createServer|server\.listen)/i;
  const echoOrInProcess =
    /\b(?:use[ds]?|using|ran|run|with|via)\s+(?:an?\s+)?(?:local\s+|temporary\s+)?echo(?:\s+agent|\s+adapter)?\b|\b(?:name|id)\s*:\s*["']echo["']|\bin[- ]process\s+(?:replacement|substitute|stand[- ]?in|fake|mock|stub)\b|(?:进程内|本地函数)[^。\n]{0,40}(?:替代|模拟|桩|占位)/i;
  return materials.some((text) =>
    positiveUse.test(text) || explicitModel.test(text) || chineseUse.test(text) ||
    serverWithMarker.test(text) || echoOrInProcess.test(text)
  );
}

function assertStandInContracts(): void {
  const fixtures: Array<[string, string[], boolean]> = [
    [
      "known-5671",
      ["Verified the harness with a transient local protocol stub; model=stub-model."],
      true,
    ],
    ["chinese", ["通过临时模拟服务跑过一次，目标应用仍未启动。"], true],
    ["echo-agent", ['const agent = defineAgent({ name: "echo", send });'], true],
    ["in-process", ["用进程内函数替代了目标服务。"], true],
    ["negated", ["No mocked service will be substituted for the real evaluation."], false],
    ["fixture-server-only", ["const server = http.createServer(handler); server.listen(8001);"], false],
  ];
  for (const [name, material, expected] of fixtures) {
    const actual = hasExplicitStandIn(material);
    if (actual !== expected) throw new Error(`install stand-in contract ${name} 失败`);
  }
}

assertStandInContracts();

function hasDiscoveredEval(stdout: string): boolean {
  const count = /Discovered\s+(\d+)\s+evals?/i.exec(stdout)?.[1];
  if (count !== undefined) return Number(count) > 0;
  return stdout.split("\n").some((line) => /\S+\/\S+/.test(line) && !/node_modules|docs-site/.test(line));
}

function parseExpPlan(stdout: string): ExpPlan | null {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as ExpPlan;
  } catch {
    const marker = trimmed.lastIndexOf('"format":"niceeval.exp-plan"');
    if (marker < 0) return null;
    const start = trimmed.lastIndexOf("{", marker);
    for (let end = trimmed.length; start >= 0 && end > start; end = trimmed.lastIndexOf("}", end - 1)) {
      if (end < 0) break;
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ExpPlan;
      } catch {
        // 继续缩短到前一个闭合括号。
      }
    }
    return null;
  }
}

function isSingleAttemptPlan(plan: ExpPlan | null): boolean {
  return plan?.matrix?.length === 1 &&
    plan.attempts === 1 &&
    plan.total === 1 &&
    plan.evals === 1 &&
    plan.configs === 1;
}

async function runCandidateCli(
  sandbox: ScoreTestContext["sandbox"],
  root: string,
  args: readonly string[],
) {
  return sandbox.runCommand("./node_modules/.bin/niceeval", [...args], { cwd: root });
}

async function locateInstallRoot(sandbox: ScoreTestContext["sandbox"]): Promise<string | null> {
  const hit = (
    await sandbox.runShell(
      "find . -maxdepth 3 -name niceeval.config.ts -not -path '*/node_modules/*' | head -1",
    )
  ).stdout.trim();
  if (!hit) return null;
  return hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
}

async function readAuthoredSource(sandbox: ScoreTestContext["sandbox"], root: string): Promise<string> {
  const result = await sandbox.runShell(
    `for path in niceeval.config.ts evals experiments agents adapters; do
  if [ -f "$path" ]; then printf '\n// @file %s\n' "$path"; cat "$path"; fi
  if [ -d "$path" ]; then
    find "$path" -type f -name '*.ts' | sort | head -30 | while IFS= read -r file; do
      printf '\n// @file %s\n' "$file"; cat "$file"
    done
  fi
done`,
    { cwd: root },
  );
  return result.stdout.trim();
}

const AGENT_OUTPUT_ROOT = resolve(import.meta.dirname, "../../../.agent-output");

async function archiveAgentOutput(t: ScoreTestContext, target: string): Promise<void> {
  try {
    const root = await locateInstallRoot(t.sandbox);
    if (root === null) return;
    const version = safeSlug(String(t.flags.candidateVersion ?? "unknown"));
    const model = safeSlug(t.model ?? "model");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolve(AGENT_OUTPUT_ROOT, version, safeSlug(target), `${stamp}__${model}`);
    mkdirSync(out, { recursive: true });

    let got = false;
    for (const dir of ["evals", "experiments", "agents", "adapters"]) {
      await t.sandbox.downloadDirectory(`${root === "." ? "" : `${root}/`}${dir}`, resolve(out, dir))
        .then(() => { got = true; })
        .catch(() => {});
    }
    await t.sandbox.downloadFile(
      `${root === "." ? "" : `${root}/`}niceeval.config.ts`,
      resolve(out, "niceeval.config.ts"),
    ).then(() => { got = true; }).catch(() => {});
    if (!got) {
      rmSync(out, { recursive: true, force: true });
      return;
    }
    writeFileSync(resolve(out, "_meta.txt"), `target=${target}\ncandidateVersion=${version}\nmodel=${model}\n`);
    t.log(`agent 产出已归档到 ${out}`);
  } catch (error) {
    t.log(`归档 agent 产出失败（已忽略）：${error instanceof Error ? error.message : String(error)}`);
  }
}

function safeSlug(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}
