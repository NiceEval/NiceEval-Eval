/**
 * install 正式评估的唯一入口。
 *
 * 这两道题评的是候选 INIT.md + 随包文档能否把 coding agent 带到一个可审阅的 NiceEval
 * 闭环，不把 `niceeval show` 的结果冒充成「真实宿主身份证明」。评分状态机与上限固定为：
 *
 *   首轮交互 8 → 完成交接 4 → 安装基础 12 → Attempt 闭环 15 → 源码与实践 13 = 52
 *
 * 基础结构、有效 locator、非 errored、ASSISTANT 映射与明确 stand-in 是 `orStop`；它们
 * 只停止后续奖励，已经得到的分数都会保留。已知 stand-in 最多 34/52，errored 最多 28/52。
 * 每个评分 key、分值、证据和 barrier 都留在对应阶段，不再跨十几个 helper 追控制流。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineScoreEval, type ScoreTestContext } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import {
  actionRef,
  command,
  gitCheckout,
  sandboxLayer,
  sandboxState,
  shell,
  type SandboxLayer,
} from "niceeval/sandbox";

type Turn = Awaited<ReturnType<ScoreTestContext["send"]>>;

interface InstallCase {
  id: "db-gpt" | "gpt-researcher";
  description: string;
  sandbox: SandboxLayer<"command-only">;
  expectedPages: RegExp;
  clarification: {
    transport: string;
    telemetry: string;
    variants: string;
  };
  quality: {
    system: string;
    coreUseCase: string;
    useCaseShape: string;
    bypass?: string;
    assertionShape: string;
    negativeRisk: string;
  };
}

const DB_GPT: InstallCase = {
  id: "db-gpt",
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  sandbox: sandboxLayer()
    .before(installRuntimeImport("db-gpt-v0.8.1"))
    .before(gitCheckout({
      id: "niceeval-eval.install-fixture.db-gpt-v0.8.1.checkout",
      repository: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "177bfc84f77e7f7760c055a748b0e4bb82d9fa47",
      to: ".",
      sparse: { include: ["/*"], exclude: ["/docs/", "/assets/"] },
      changeFrequency: 20,
      dependsOn: [actionRef(installRuntimeActionId("db-gpt-v0.8.1"))],
    }))
    .before(command("rm", ["-rf", ".git"], {
      id: "niceeval-eval.install-fixture.db-gpt-v0.8.1.detach",
      changeFrequency: 21,
      dependsOn: [actionRef("niceeval-eval.install-fixture.db-gpt-v0.8.1.checkout")],
    })),
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(connect-your-agent|write-send)\.mdx|docs-site\/zh\/tutorials\/quickstart\.mdx/,
  clarification: {
    transport:
      "HTTP + JSON/SSE，默认端口 5670；OpenAI Chat Completions 兼容入口是 " +
      "POST /api/v2/chat/completions，前端主聊天另走 /api/v1/chat/completions，没有 WebSocket。",
    telemetry:
      "自带本地 tracer，并可选启用标准 OTel/OTLP 导出；因此应确认是保持 Tier 1，还是复用现有 tracing。",
    variants:
      "model、chat_mode、chat_param、temperature、max_new_tokens 与 stream 都可能形成实验变体。",
  },
  quality: {
    system: "DB-GPT",
    coreUseCase:
      "用户用自然语言问真实库表，DB-GPT 通过 chat_data / chat_db_qa / chat_dashboard 等模式生成 SQL、" +
      "查询并分析；chat_normal 只是裸 LLM 闲聊。",
    useCaseShape: "具体的数据问答或分析任务，并使用能触达数据库的模式及对应数据源参数",
    bypass: "；chat_normal 下问常识或算术也没有触达 DB-GPT 的差异化能力",
    assertionShape: "检查具体数值、表名、SQL 片段等业务结果，而不是只检查有回复或 HTTP 成功",
    negativeRisk: "不存在的库表或字段被编造成看似合理的结果，而不是明确报告不存在",
  },
};

const GPT_RESEARCHER: InstallCase = {
  id: "gpt-researcher",
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",
  sandbox: sandboxLayer()
    .before(installRuntimeImport("gpt-researcher-v3.6.0"))
    .before(gitCheckout({
      id: "niceeval-eval.install-fixture.gpt-researcher-v3.6.0.checkout",
      repository: "https://github.com/assafelovic/gpt-researcher.git",
      ref: "5d84d2f5553e70a2765a8ff3a0d2672d60437ce8",
      to: ".",
      changeFrequency: 20,
      dependsOn: [actionRef(installRuntimeActionId("gpt-researcher-v3.6.0"))],
    }))
    .before(command("rm", ["-rf", ".git"], {
      id: "niceeval-eval.install-fixture.gpt-researcher-v3.6.0.detach",
      changeFrequency: 21,
      dependsOn: [actionRef("niceeval-eval.install-fixture.gpt-researcher-v3.6.0.checkout")],
    })),
  expectedPages:
    /docs-site\/zh\/(how-to|tutorials)\/(write-send|connect-your-agent)\.mdx|docs-site\/zh\/reference\/events\.mdx/,
  clarification: {
    transport:
      "主路径是 FastAPI /ws：客户端发送 `start ` + JSON，服务端依次返回 logs/images/report/path 帧；" +
      "REST 入口也不是 OpenAI Chat Completions 形状。",
    telemetry:
      "没有 OpenTelemetry；只有可选 LangSmith tracing，因此应确认保持 Tier 1 还是另接观测链路。",
    variants: "report_type、tone 与 report_source 都可以形成研究配置变体。",
  },
  quality: {
    system: "GPT Researcher",
    coreUseCase: "对具体主题自主检索多源资料，产出带引用来源的结构化研究报告正文",
    useCaseShape: "具体研究主题，输出应包含实质内容、结构化章节和引用 URL",
    assertionShape: "检查主题相关内容、报告结构和引用来源，而不是只检查任务提交回执或非空文本",
    negativeRisk: "虚构且不可能有可靠来源的主题被写成看似有据的报告，而不是明确说无法核实",
  },
};

export default {
  "db-gpt": createInstallEval(DB_GPT),
  "gpt-researcher": createInstallEval(GPT_RESEARCHER),
};

function installRuntimeActionId(owner: string): string {
  return `niceeval-eval.install-fixture.${owner}.import-runtime-python`;
}

/**
 * 每个正式 install Eval 都拥有一枚可审计的 dockerData action。它只校验并导入镜像；
 * checkout、workspace、home、凭证和答案都不进入可缓存前缀。
 */
function installRuntimeImport(owner: string) {
  return shell({
    id: installRuntimeActionId(owner),
    command: `set -eu
runtime_dir=/opt/niceeval-install/runtime
cd "$runtime_dir"
sha256sum -c runtime-python.tar.gz.sha256
docker import runtime-python.tar.gz offline.invalid/niceeval-install/runtime:python
docker run --pull=never --rm --entrypoint /bin/sh \\
  offline.invalid/niceeval-install/runtime:python \\
  -c 'node -v && git --version && python3 --version'
printf '%s\\n' 'install runtime 就绪：offline.invalid/niceeval-install/runtime:python'`,
    user: "root",
    changeFrequency: 10,
    cache: { state: sandboxState.dockerData },
  });
}

function createInstallEval(installCase: InstallCase) {
  return defineScoreEval({
    description: installCase.description,
    judge: true,
    timeoutMs: 35 * 60 * 1000,
    sandbox: installCase.sandbox,
    async test(t) {
      const version = t.flags.candidateVersion;
      if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");
      assertCandidatePages(version, installCase.expectedPages);

      const prompt =
        `READ ${candidateInitDocUrl(version)} and install niceeval for this repo\n` +
        `This machine must end up with niceeval@${version} exactly — not whatever version is latest.\n` +
        "The first minimal experiment must use the provided offline.invalid/niceeval-install/runtime:python image. " +
        "It is a digest-pinned generic Node/git/Python base only: it contains no NiceEval, application dependencies, " +
        "running service, Eval answers, or historical results. You must still install candidate NiceEval and application " +
        "dependencies, start the real target service, author the adapter/Eval/experiment, and actually run the first niceeval exp.\n" +
        "Target-app runtime credentials are available in /opt/fixture-secrets/target-app.env. " +
        "Source that file only into the target service process; never print it or copy its values into the workspace.";
      const firstTurn = await t.send(prompt);

      try {
        await scoreFirstTurn(t, firstTurn, installCase);
        const handoff = await continueWithMinimalAnswer(t, firstTurn);
        await scoreHandoff(t, handoff, installCase);

        const foundation = await scoreFoundation(t, version);
        const authoredSource = await readAuthoredSource(t.sandbox, foundation.root);
        await scorePublishedAttempt(t, handoff, foundation, authoredSource);
        await scoreSourceQuality(t, installCase, foundation, authoredSource);
      } finally {
        await archiveAgentOutput(t, installCase.id);
      }
    },
  });
}

// ── 1. 首轮交互（8 分，全部软分） ─────────────────────────────────────────────

async function scoreFirstTurn(t: ScoreTestContext, turn: Turn, installCase: InstallCase): Promise<void> {
  await t.group("首轮交互 · 8 分", async () => {
    t.check(turn.status === "waiting", isTrue("写代码前等待用户确认接入方案"))
      .score(1)
      .key("install.interaction.waited")
      .label("先等待方案确认");

    const clarificationRubrics = [
      [
        "interface",
        "核对接口",
        `有没有陈述它从仓库确认的 ${installCase.quality.system} 传输方案并请用户核对？` +
          `大方向应接近：${installCase.clarification.transport}`,
      ],
      [
        "telemetry",
        "核对观测方案",
        `有没有询问是否接 tracing / OTel，并把 ${installCase.clarification.telemetry} 作为仓库背景而非既定选择？`,
      ],
      [
        "variants",
        "核对实验变体",
        `有没有询问是否做多配置对比或 flags？仓库可支持的方向包括：${installCase.clarification.variants}`,
      ],
      [
        "tier",
        "摆出接入等级",
        "有没有让用户在 Tier 1（send）、Tier 2（send + OTel）、Tier 3（侵入改造 + flags）之间选择？",
      ],
    ] as const;
    for (const [key, label, criteria] of clarificationRubrics) {
      turn.judge.autoevals.closedQA(
        `只判断 agent 写代码前的第一条回复是否做到【${label}】。${criteria} 不要因为其它维度缺失而判 N。`,
      ).score(1).key(`install.interaction.${key}`).label(label);
    }

    const scopeRubrics = [
      [
        "use-case",
        "首条 Eval 贴核心用例",
        `有没有基于仓库提出一条具体的首个 Eval 评估面并请用户核对？核心能力是：` +
          `${installCase.quality.coreUseCase}；合格形状接近：${installCase.quality.useCaseShape}${installCase.quality.bypass ?? ""}。`,
      ],
      [
        "success-risk",
        "核对结果与风险",
        `有没有提出可观察的业务成功结果，并指出至少一个重要失败风险？` +
          `结果应接近：${installCase.quality.assertionShape}；风险是：${installCase.quality.negativeRisk}。`,
      ],
      [
        "runtime-boundary",
        "核对运行边界",
        "有没有确认安全测试数据或本地服务、Judge 可用性，以及首跑时间/Attempt/付费范围；不能默认无限调用。",
      ],
    ] as const;
    for (const [key, label, criteria] of scopeRubrics) {
      turn.judge.autoevals.closedQA(
        `只判断第一条回复是否做到【${label}】。${criteria} 仓库可确认的事实应由 agent 先提出，不应甩给用户。`,
      ).score(1).key(`install.interaction.scope.${key}`).label(label);
    }
  });
}

async function continueWithMinimalAnswer(t: ScoreTestContext, turn: Turn): Promise<Turn> {
  // 这里只回答真实产品选择，不替 agent 设计用例、断言、负例、候选轴或矩阵，避免泄露 rubric。
  const answer =
    "做简单的 Tier 1 接入，使用你刚才确认的接口；先不接 OTel，也不做 experiment flags。" +
    "没有可用 Judge key 时，按文档选择不依赖 Judge 的验证方式。" +
    "请继续完成接入，首跑保持每格一次的最小规模，并实际运行后用 niceeval show 查看结果。" +
    "其余实现细节由你根据仓库和随包文档决定。";
  const requests = turn.events.flatMap((event) =>
    event.type === "input.requested" ? [event.request] : []
  );
  return turn.status === "waiting"
    ? await t.respond(...requests.map((request) => ({ request, text: answer })))
    : await t.send(answer);
}

// ── 2. 完成交接（4 分，全部软分） ─────────────────────────────────────────────

async function scoreHandoff(t: ScoreTestContext, handoff: Turn, installCase: InstallCase): Promise<void> {
  await t.group("完成交接 · 4 分", async () => {
    handoff.succeeded()
      .score(2)
      .key("install.handoff.completed-turn")
      .label("完成轮正常结束");
    handoff.judge.autoevals.closedQA(
      `只判断 ${installCase.quality.system} 接入的最终回复是否交代：三件套文件位置、复现用 exp/show 命令，` +
        "以及实际 verdict 或阻塞。若只跑了 stub/mock，必须明确说明它不是目标宿主结果；不能把 errored/failed 包装成全绿。",
    ).score(1).key("install.handoff.reported-result").label("如实交代首跑结果");
    handoff.judge.autoevals.closedQA(
      "只判断最终回复是否把继续投入的决定交还用户，并给出至少一个具体升级选项及收益；不能未经同意扩大付费范围。",
    ).score(1).key("install.handoff.next-step").label("交还下一步选择");
  });
}

// ── 3. 安装基础（12 分，逐级 barrier） ───────────────────────────────────────

interface FoundationEvidence {
  root: string;
  packageJson: PackageManifest | null;
  managedGuidance: boolean;
}

interface PackageManifest {
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ExpPlan {
  matrix?: unknown[];
  attempts?: number;
  runs?: number;
}

async function scoreFoundation(t: ScoreTestContext, version: string): Promise<FoundationEvidence> {
  const root = await locateInstallRoot(t.sandbox);
  await t.group("安装基础 · 12 分", async () => {
    await t.check(root !== null, isTrue("niceeval.config.ts 存在"))
      .score(3)
      .key("install.foundation.config")
      .label("找到安装根")
      .orStop();
  });
  if (root === null) throw new Error("config barrier 没有终止评分");

  const installed = await t.sandbox.runCommand(
    "node",
    ["-p", "require('./node_modules/niceeval/package.json').version"],
    { cwd: root },
  );
  await t.group("安装基础 · 精确版本", async () => {
    await t.check(
      installed.stdout.trim(),
      satisfies(`依赖必须精确解析为 niceeval@${version}`, (value) => value === version),
    ).score(3).key("install.foundation.version").label("候选版本正确").orStop();
  });

  const list = await runCandidateCli(t.sandbox, root, ["list"]);
  await t.group("安装基础 · Eval 发现", async () => {
    await t.check(list, commandSucceeded())
      .score(2)
      .key("install.foundation.list")
      .label("项目内 CLI 可发现 Eval")
      .orStop();
    await t.check(
      list.stdout,
      satisfies("list 至少发现一条 Eval", (value) => hasDiscoveredEval(value as string)),
    ).score(1).key("install.foundation.discovered-eval").label("至少一条 Eval").orStop();
  });

  const dry = await runCandidateCli(t.sandbox, root, ["exp", "--dry", "--json"]);
  const dryPlan = parseExpPlan(dry.stdout);
  await t.group("安装基础 · dry plan", async () => {
    await t.check(
      dryPlan,
      satisfies("exp --dry --json 能规划至少一格", (value) => {
        const plan = value as ExpPlan | null;
        return dry.exitCode === 0 && (plan?.matrix?.length ?? 0) > 0;
      }),
    ).score(3).key("install.foundation.dry-plan").label("实验可规划").orStop();
  });

  const packageJson = parsePackageJson(
    (await t.sandbox.runCommand("cat", ["package.json"], { cwd: root })).stdout,
  );
  const managedGuidance = (
    await t.sandbox.runShell(
      "grep -l 'BEGIN:niceeval-agent-rules' AGENTS.md CLAUDE.md 2>/dev/null | head -1",
      { cwd: root },
    )
  ).stdout.trim().length > 0;
  return { root, packageJson, managedGuidance };
}

// ── 4. 同一 Attempt 的公开闭环（15 分，逐级 barrier） ─────────────────────────

interface PublishedAttempt {
  locator: string;
  overview: Awaited<ReturnType<ScoreTestContext["sandbox"]["runCommand"]>>;
}

async function scorePublishedAttempt(
  t: ScoreTestContext,
  handoff: Turn,
  foundation: FoundationEvidence,
  authoredSource: string,
): Promise<void> {
  const bareShow = await runCandidateCli(t.sandbox, foundation.root, ["show"]);
  const published = await selectPublishedAttempt(t, foundation.root, handoff.message, bareShow.stdout);

  await t.group("Attempt 闭环 · 15 分", async () => {
    await t.check(
      published !== null,
      isTrue("handoff 引用或 bare show 最后渲染项能被精确 show @locator 打开"),
    ).score(4).key("install.attempt.published").label("发布了可下钻 Attempt").orStop();
  });
  if (published === null) throw new Error("locator barrier 没有终止评分");

  const verdict = parseAttemptVerdict(published.overview.stdout);
  await t.group("Attempt 闭环 · verdict", async () => {
    await t.check(
      verdict === "passed" || verdict === "failed",
      isTrue(`同一 locator 到达 passed/failed（实际：${verdict ?? "无法识别"}）`),
    ).score(3).key("install.attempt.non-errored").label("Attempt 非 errored").orStop();
  });

  const execution = await runCandidateCli(t.sandbox, foundation.root, [
    "show",
    published.locator,
    "--execution",
  ]);
  await t.group("Attempt 闭环 · 事件映射", async () => {
    await t.check(
      execution.stdout,
      satisfies("同一 locator 的 execution 含 ASSISTANT 消息", (value) =>
        /^\s*ASSISTANT\b/m.test(value as string)
      ),
    ).score(3).key("install.attempt.assistant-event").label("映射出 ASSISTANT").orStop();
  });

  const source = await runCandidateCli(t.sandbox, foundation.root, [
    "show",
    published.locator,
    "--source",
  ]);
  const assistantMessages = t.events.flatMap((event) =>
    event.type === "message" && event.role === "assistant" ? [event.text] : []
  );
  const explicitStandIn = hasExplicitStandIn([
    ...assistantMessages,
    execution.stdout,
    source.stdout,
    authoredSource,
  ]);
  await t.group("Attempt 闭环 · stand-in 上限", async () => {
    await t.check(
      !explicitStandIn,
      isTrue("未发现明确使用 stand-in 的正面证据；这不证明背后是真实宿主"),
    ).score(1).key("install.attempt.no-explicit-stand-in").label("未发现明确 stand-in（不证明真实宿主）").orStop();

    t.check(verdict === "passed", isTrue("候选 Attempt verdict 为 passed"))
      .score(4)
      .key("install.attempt.passed")
      .label("候选 verdict passed");
  });
}

// ── 5. 源码与实践（13 分，只有通过闭环 barriers 后才执行） ─────────────────────

async function scoreSourceQuality(
  t: ScoreTestContext,
  installCase: InstallCase,
  foundation: FoundationEvidence,
  source: string,
): Promise<void> {
  const pkg = foundation.packageJson;
  await t.group("源码实践 · 9 分", async () => {
    t.check(
      !!pkg?.devDependencies?.niceeval && !pkg.dependencies?.niceeval,
      isTrue("niceeval 只在 devDependencies"),
    ).score(1).key("install.practice.dev-dependency").label("开发依赖");
    t.check(pkg?.type === "module", isTrue('独立工作区 package.json 是 "type": "module"'))
      .score(1).key("install.practice.esm").label("ESM 工作区");
    t.check(foundation.root !== ".", isTrue("Python 宿主使用独立 NiceEval 子工作区"))
      .score(1).key("install.practice.standalone-workspace").label("独立工作区");
    t.check(foundation.managedGuidance, isTrue("init 写入托管 AGENTS/CLAUDE 区块"))
      .score(1).key("install.practice.managed-guidance").label("托管指引区块");
    t.check(
      source,
      satisfies("experiment 显式限制 attempts/runs 为 1", (value) =>
        /\b(?:attempts|runs):\s*1\b/.test(value as string)
      ),
    ).score(1).key("install.practice.single-attempt").label("每格一次");
    t.check(
      source,
      satisfies("adapter 有 HTTP/WebSocket 传输调用", (value) =>
        /\bfetch\s*\(|\bWebSocket\b|axios|https?\.request\s*\(/.test(value as string)
      ),
    ).score(1).key("install.practice.transport").label("真实传输层写法");
    t.check(source, satisfies("adapter 转发 ctx.signal", (value) => /ctx\.signal/.test(value as string)))
      .score(1).key("install.practice.signal").label("转发取消信号");
    t.check(source, satisfies("adapter 消费 ctx.model", (value) => /ctx\.model/.test(value as string)))
      .score(1).key("install.practice.model").label("消费 experiment model");
    t.check(
      source,
      satisfies("Eval 使用 NiceEval 官方断言词汇", (value) =>
        /\.(?:check|require|messageIncludes|succeeded)\s*\(|\.judge\./.test(value as string)
      ),
    ).score(1).key("install.practice.assertions").label("官方断言词汇");
  });

  const quality = installCase.quality;
  const material = {
    input: `下面是 agent 为 ${quality.system} 写出的 NiceEval 三件套源码。`,
    output: source || "（无）",
  };
  await t.group("Eval 设计质量 · 4 分", async () => {
    t.judge.autoevals.closedQA(
      `【核心用例】Eval 输入是否贴着 ${quality.coreUseCase}？合格形状是：${quality.useCaseShape}` +
        `${quality.bypass ?? ""}。hello、自我介绍或无关常识不合格。`,
      material,
    ).score(1).key("install.quality.core-use-case").label("核心用例");
    t.judge.autoevals.closedQA(
      `【具体断言】是否${quality.assertionShape}，且开放措辞使用 judge、结构检查或宽容 matcher？` +
        "只有 succeeded、非空或单一脆弱短语不合格。",
      material,
    ).score(1).key("install.quality.assertion").label("具体且稳健的断言");
    t.judge.autoevals.closedQA(
      `【负例】是否覆盖“${quality.negativeRisk}”，且 prompt 没有直接教被测系统标准拒答？`,
      material,
    ).score(1).key("install.quality.negative").label("真实负例");
    t.judge.autoevals.closedQA(
      `【实验耦合】experiment 是否使用同一个 ${quality.system} adapter，Eval 测的也是该系统，` +
        "而不是 echo/通用占位 agent？",
      material,
    ).score(1).key("install.quality.coupling").label("Experiment 与 Eval 耦合");
  });
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
  bareShow: string,
): Promise<PublishedAttempt | null> {
  const explicit = [...extractAttemptLocators(handoff)].reverse();
  const fallback = [...extractAttemptLocators(bareShow)].reverse();
  for (const locator of [...explicit, ...fallback]) {
    const overview = await runCandidateCli(t.sandbox, root, ["show", locator]);
    if (overview.exitCode === 0) return { locator, overview };
  }
  return null;
}

function parseAttemptVerdict(stdout: string): "passed" | "failed" | "errored" | null {
  const header = stdout.split("\n").slice(0, 16).join("\n");
  return /\berrored\b/i.test(header)
    ? "errored"
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
  return materials.some((text) =>
    positiveUse.test(text) || explicitModel.test(text) || chineseUse.test(text) || serverWithMarker.test(text)
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

function parsePackageJson(stdout: string): PackageManifest | null {
  try {
    return JSON.parse(stdout) as PackageManifest;
  } catch {
    return null;
  }
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

function candidateInitDocUrl(version: string): string {
  return `https://raw.githubusercontent.com/CorrectRoadH/niceeval/v${version}/INIT.md`;
}

function assertCandidatePages(version: string, expected: RegExp): void {
  const manifestPath = resolve(import.meta.dirname, "../../.candidate", version, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { pages?: string[] };
  const pages = manifest.pages ?? [];
  if (!pages.includes("INDEX.md")) return;
  if (pages.some((page) => expected.test(page))) return;
  throw new Error(`候选 niceeval@${version} 的随包文档没有题库要求的页面：${expected.source}`);
}

const AGENT_OUTPUT_ROOT = resolve(import.meta.dirname, "../../.agent-output");

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
