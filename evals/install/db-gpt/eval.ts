import { tasteReviewer } from "../../judges/niceeval-taste.ts";
import { projectStructureReviewer } from "../../judges/project-structure.ts";
import { appropriateQuestionsReviewer } from "../../judges/appropriate-questions.ts";
import { sessionEvidence } from "../../judges/session-evidence.ts";
import { simulatedUserDiscipline } from "../../users/discipline.ts";
/**
 * DB-GPT install：候选 INIT.md + 随包文档能否把 coding agent 带到真实、可复审的 NiceEval 接入。
 *
 * 分数是 Adapter、Experiment、Eval、真实证据与首轮理解的自然价值累加，不设总分上限，
 * 也不为必要但无区分度的安装事实发分：精确版本、config、CLI discovery、有效 dry plan、
 * 交接 locator 和取证命令只做 gate。源码先评，安装或运行失败不会抹掉源码证据。
 */

import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { commandSucceeded, countWhere, equals, greaterThan, isDefined, or, referencesAnyPath, toolMatch, binaryJudge } from "niceeval/expect";
import { command, gitCheckout, sandboxRequirements } from "niceeval/sandbox";
import { firstTurnQuestions, firstTurnWrittenNotes } from "../first-turn.ts";
import { candidateInitDocUrl, ONLINE_MAIN_DOC_REFERENCES } from "../docs.ts";
import { query } from "../../../lib/query.ts";

/** 评审者：在被测 Sandbox 里自己读文件、跑命令取证，同一会话里逐题打分。*/

/** 模拟用户：仓库维护者已经拿定的决定。只回答 agent 问到的事，没决定过的交还给它自己判断。*/
const owner = defineSimulatedUser({
  instructions: `${simulatedUserDiscipline}
身份：你是 DB-GPT 仓库维护者，刚请对方接入 NiceEval。
已决定事实：选 Tier 1，首跑不接 OTel/OTLP；没有可用的 Judge key。目标模型用 /opt/fixture-secrets/target-app.env 的 TARGET_APP_MODEL，出口只接受该模型，不做 experiment flags。凭证仅注入目标服务进程，不输出、不提交、不复制进工作区。OPENAI_EXTRA_HEADERS 是 JSON 对象，包含 Cloudflare Access 头，运行时读取并随每次 LLM 请求发送。机器可联网，可按上游方式安装依赖或拉取镜像。
未决定事项：数据场景、Adapter 和评估写法由对方依据仓库和随包文档确定。
压力与反应：可自主运行、诊断、修复和重试，不限制格数、Attempt 数或轮次，无需再申请运行授权；实际成本计入评估。`,
});

export default defineScoreEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",

  timeoutMs: 80 * 60 * 1000,
  sandbox: sandboxRequirements({})
    .before(gitCheckout({
      id: "db-gpt-checkout",
      repository: "https://github.com/eosphoros-ai/DB-GPT.git",
      ref: "177bfc84f77e7f7760c055a748b0e4bb82d9fa47",
      to: ".",
      sparse: { include: ["/*"], exclude: ["/docs/", "/assets/"] },
    }))
    // 重建一个只有一次 baseline 提交的仓库：agent 面对的是普通 git 项目，评审用 git status / git diff 看它改了什么。
    .before(command("rm", ["-rf", ".git"], { id: "drop-upstream-git" }))
    .before(command("git", ["init", "-q"], { id: "git-init" }))
    .before(command("git", ["add", "-A"], { id: "git-add-baseline" }))
    .before(command("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"], { id: "git-commit-baseline" })),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");

    // 官网首页给用户复制的同一句 prompt（NiceEval apps/site/lib/content.ts），URL 换成候选 tag 下的 INIT.md。
    // INIT.md 让 agent 装 npm latest；评的是候选版本，所以只多一句版本要求。
    const session = sessionEvidence();
    const firstTurn = await session.record(t.send(
      `READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\n` +
      `Use niceeval@${version} exactly.`,
    ));

    // ── 文档与首轮理解 ──
    const firstRound = { turn: firstTurn, writtenNotes: await firstTurnWrittenNotes({ runShell: (script) => t.sandbox.runShell(script) }), questions: firstTurnQuestions(firstTurn) };
    await t.group("文档与首轮理解", async () => {
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否说清它选用的 DB-GPT 入口与协议形状（路径、请求字段、JSON 或 SSE 返回），并且本轮命令里能看到它读过定义这个入口的路由源码？" +
        "仓库里有多条真实入口，例如 POST /api/v2/chat/completions、/api/v1/chat/completions、/api/v1/chat/react-agent，选哪条都可以。" +
        "只说“调 API”、猜 WebSocket，或说出的路径在命令读过的源码里找不到，不算。" }))
        .score(2).label("核对接入协议");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否说明 DB-GPT 的差异化能力是让 LLM 访问数据源、生成并执行 SQL，并把它和只调裸 LLM 的普通聊天区分开？" +
        "chat_data / chat_db_qa / chat_dashboard 对 chat_normal，或 react-agent 数据分析对普通对话，都算。" }))
        .score(2).label("核对能力边界");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否在编写 Adapter、Experiment 或 Eval 之前询问了 Judge 用哪个服务、模型或 Key，或者说明没有 Judge 时先只写精确判据？" +
        "此前安装依赖、运行 niceeval init 不算动手实现。" }))
        .score(1).label("询问 Judge");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否在真实运行 Experiment 之前询问了首跑的 Attempt 数、时间或费用预算？安装依赖、写源码与 --dry 都不花预算，不算。" }))
        .score(1).label("询问首跑预算");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否在编写 Adapter、Experiment 或 Eval 之前明确停下，把需要用户决定的选择留给用户？首轮进入 waiting 且提出了需要用户决定的问题也算停下，普通文本请求确认也算；" +
        "INIT.md 要求先安装再读随包文档，所以停下之前安装依赖、运行 niceeval init、阅读仓库与文档都不算动手。只反问本应从仓库查明的接口事实不算。" }))
        .score(1).label("首轮停下等用户决定");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否主动提出了一条具体的首个 Eval 核心用例：用户用自然语言问一份内容固定的真实数据里的问题，DB-GPT 访问这份数据、" +
        "执行 SQL 或分析代码，再给出答案？数据可以是数据库表，也可以是交给 react-agent 数据分析的 CSV/Excel 文件。" +
        "要说出具体问题和具体的表或文件；只提 hello、HTTP 成功、非空回复，或“某个销售分析问题”这种还没定下来的计划，不算。" }))
        .score(2).label("提出核心用例");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否说明了这条用例可观察的业务成功结果，例如核对具体数值、表名或 SQL？" }))
        .score(1).label("说明成功判据");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否指出了主要失败风险，例如对不存在的表/字段编造结果？" }))
        .score(1).label("指出主要风险");
    });

    const user = t.simulatedUser(owner);
    let answered = firstTurn.status === "waiting" ? 1 : 0;
    if (firstTurn.status !== "waiting") session.addPlainReply(firstTurn.reply);
    let handoff = await session.record(user.reply(firstTurn));
    while (handoff.status === "waiting" && answered < 6) {
      handoff = await session.record(user.reply(handoff));
      answered++;
    }
    t.note("会话效率", session.efficiency(t.usage.totalTokens));
    const questions = t.agentJudge(appropriateQuestionsReviewer, { questions: session.questions(), context: "安装版本已经由题面给定；业务数据范围与实验条件需由用户确认。" });
    questions.judge("agent 的提问确认了要评估的 DB-GPT 数据问答范围或数据来源。").score(1).label("提问得当");
    t.note("HITL 回答次数", { answered, firstReplyWasHITL: firstTurn.status === "waiting", stillWaiting: handoff.status === "waiting" });

    // 路由看整段主会话：先停下问用户、第二轮才读 Adapter 页面的 agent 不该因此丢分。
    t.toolOrder([
      toolMatch({ input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
      toolMatch({ input: referencesAnyPath([
        "node_modules/niceeval/docs-site/zh/tutorials/connect-your-agent.mdx",
        "node_modules/niceeval/docs-site/zh/tutorials/write-send.mdx",
        "node_modules/niceeval/docs-site/zh/tutorials/quickstart.mdx",
        "node_modules/niceeval/docs-site/zh/reference/events.mdx",
      ]) }),
    ]).score(3).label("从随包 INDEX 路由到相关页面");

    // 两轮都算：文档站与仓库 main 分支上的任何文件都是另一个版本的内容，带版本 tag 的地址不算。
    t.notCalledTool(toolMatch({ input: referencesAnyPath(ONLINE_MAIN_DOC_REFERENCES, { ignoreCase: true }) }))
      .score(1).label("没有退回 online main 文档");

    // ── 源码设计：先于所有安装与运行 gate 评审 ──
    // agent 自建的 NiceEval 项目根：含 niceeval.config.ts 的目录，没装上时为 null。
    const configPath = (await t.sandbox.runShell(
      "find . -maxdepth 3 -name niceeval.config.ts -not -path '*/node_modules/*' | head -1",
    )).stdout.trim();
    const root = configPath === "" ? null : configPath.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
    const structure = t.agentJudge(projectStructureReviewer, { installRoot: root });
    structure.chat("用 baseline 后的 git 状态核对 DB-GPT 接入的新增文件；根没有 Node 工具项目，web/ 是前端应用。");
    structure.judge("DB-GPT 的临时样本、运行输出和草稿没有混入正式的 NiceEval 接入目录。")
      .score(1).label("接入目录只含正式交付文件");
    const reviewSource = () => {
      const review = t.agentJudge(tasteReviewer, { installRoot: root, handoff: handoff.reply });
      review.chat("正在评审 DB-GPT 的 NiceEval 接入。 installRoot 是 niceeval.config.ts 所在目录。仓库的 baseline 提交是 agent 动手前的状态，用 git status 与 git diff 看它改了什么。先列出 agent 写的 Adapter、Experiment、Eval 文件，以及它们 import 的项目文件。");
      return review;
    };
    reviewSource().judge(
      "安装优先复用适用的现有根工具项目或 workspace，保留原有包管理器与锁文件归属；" +
      "没有适用 Node 工具项目时允许独立建包。DB-GPT 仓库根目录没有 package.json，web/ 是前端应用而不是开发工具项目，为 NiceEval 独立建包是合理的；" +
      "已有适用的工具项目却另建安装边界时必须说明具体不兼容原因，不能仅因为被测服务是 Python。" +
      "交接必须给出从仓库根目录能使用的本地命令，子目录安装需明确目录参数或根脚本。")
      .score(3).label("安装融入宿主工具链并交付根目录入口");
    await t.group("Adapter、Experiment 与 Eval 源码设计", async () => {
      reviewSource().judge(
        "NiceEval 助手消息或标准事件的文本来自 DB-GPT 实际 JSON/SSE response/delta，" +
        "并正确组合流式分片和结束。返回输入原文、固定 ASSISTANT 文字、未读 body 或把 logs/status 当最终答案不算。")
        .score(6).label("真实响应映射为 NiceEval 消息或事件");
      reviewSource().judge(
        "Adapter 真正读取所选静态配置（如 base URL、chat_mode 或 react-agent 的数据源参数），并把它们传入 DB-GPT 请求。" +
        "只在 Experiment 声明但 send 不读取，或 send 内全部硬编码，不算。model 是否被消费不在本项判断。")
        .score(3).label("静态配置传到 DB-GPT");
      reviewSource().judge(
        "send 把 NiceEval AbortSignal 或等价取消机制传给网络请求，并设置有界超时。")
        .score(1).label("取消与超时");
      reviewSource().judge(
        "在非 2xx、SSE/JSON 解析错误、连接中断或目标服务报错时抛出或映射为失败。catch 后改返成功空文本或吞错不算。")
        .score(2).label("错误不被吞掉");
      reviewSource().judge(
        "凭证只从环境/目标服务进程边界读取，不硬编码，不写入工作区，不打印，也不混入 Eval 文本或取证输出；" +
        "/opt/fixture-secrets/target-app.env 只注入目标服务进程，不 source 到 agent shell。")
        .score(2).label("凭证边界正确");
      reviewSource().judge(
        "至少一条 Eval 输入让用户用自然语言问一份内容固定的真实数据，答案只有访问这份数据才能得到，" +
        "并且请求走的是能触达这份数据的模式并带上对应的数据源参数。哪种组合都算，只要 DB-GPT 真的去读这份数据：" +
        "chat_data / chat_db_qa / chat_dashboard 加数据库数据源，react-agent 加数据库数据源（如 ext_info.database_name），或 react-agent 加数据文件。" +
        "chat_normal 只是裸 LLM 闲聊，在它下面问常识或算术不算；没有数据源参数、hello、自我介绍或无关常识不算。")
        .score(6).label("输入覆盖 DB-GPT 核心能力");
      reviewSource().judge(
        "断言核对可预期的业务事实，例如查询数值、表/字段名、SQL 片段或与固定测试数据一致的分析结论。" +
        "只检查 succeeded、HTTP 2xx、非空文本、字数或“成功”字样不算。")
        .score(6).label("断言检查具体业务结果");
      reviewSource().judge(
        "Eval 询问固定测试数据中不存在的表或字段，并断言系统不得编造数值/SQL。" +
        "prompt 若直接教它标准拒答，或只把网络失败当负例，不算。")
        .score(4).label("真实负例暴露编造风险");
      reviewSource().judge(
        "对可有多种正确措辞的输出使用语义 Judge、解析后的结构/数值比较、或能容纳合法变体的 matcher。" +
        "仅匹配一个脆弱短语、完整原文或和业务无关的长度不算。")
        .score(3).label("开放输出使用稳健判断");
      reviewSource().judge(
        "Eval 只描述任务和断言，没有在单条 test 用例内自行启动、伪造、重启或代管 DB-GPT 全局服务。" +
        "服务生命周期位于项目级命令准备或 Experiment/Plugin/Sandbox 层面才算。")
        .score(2).label("Eval 不代管目标服务");
      reviewSource().judge(
        "Experiment 实际选择本次 DB-GPT Adapter，且它选中的 Eval 测试的也是 DB-GPT 数据问答，" +
        "而不是内置/通用/echo agent 或无关 Eval。Adapter 要能从 Experiment 的导入追到定义；Eval 的选择按 NiceEval 的规则判断：" +
        "`evals` 里的 ID 或路径前缀选中对应文件，省略 `evals` 表示选中 evals/ 下全部 Eval，不要求 Experiment 导入 Eval 文件。")
        .score(5).label("使用本次 DB-GPT Adapter 与目标 Eval");
      reviewSource().judge(
        "Experiment 声明的每个 model、flags 或静态配置都有清楚的消费方：Adapter/lifecycle 读取后传给 DB-GPT。" +
        "配了值却没有任何读取点、只改显示名或被硬编码覆盖不算。用户指定目标模型取自凭证文件里的 TARGET_APP_MODEL、不做 model 维度，所以 Experiment 不声明 model 或明确拒绝 model 覆盖都算正确。")
        .score(3).label("模型、flags 与静态配置不是死配置");
      reviewSource().judge(
        "agent 按照 DB-GPT 项目自身的最佳实践（如通过官方 CLI dbgpt start、配置与健康探测，或 Experiment/Plugin lifecycle）真实启动 DB-GPT 并确保 HTTP 入口就绪后才跑评测。" +
        "无任何启动与就绪动作仅盲目假定服务已就绪不算；使用假 mock 或进程内 fake 替代真实服务不算。")
        .score(2).label("目标服务启动与就绪");
      reviewSource().judge(
        "在 lifecycle 或任务收尾时对启动的服务进程/容器有可靠清理或回收机制。")
        .score(1).label("目标服务清理");
    });
    await t.group("Eval 判据可读性（NiceEval Taste）", async () => {
      const reviewEvalTaste = () => {
        const review = t.agentJudge(tasteReviewer, { installRoot: root });
        review.chat("正在评审 DB-GPT 的 NiceEval 接入。 installRoot 是 niceeval.config.ts 所在目录。先读完 evals/ 下 agent 写的 Eval 文件。");
        return review;
      };
      reviewEvalTaste().judge(
        "只看 evals/ 下 agent 写的 Eval 文件。只读 Eval 正文就能说出它测什么、每项什么算通过、分数或门槛怎么来；" +
        "关键阈值、数量和分值直接写在检查上，没有藏进辅助函数。")
        .score(1).label("正文读得出判据");
      reviewEvalTaste().judge(
        "只看 evals/ 下 agent 写的 Eval 文件。能直接读到的事实（工具名与参数、次数、文件内容、命令退出码、结构化字段）" +
        "用确定性检查，没有把这类事实交给 Judge 判断。")
        .score(1).label("事实用确定性检查");
      reviewEvalTaste().judge(
        "只看 evals/ 下 agent 写的 Eval 文件。能用现成 Match（equals、includes、pattern、toolMatch、countWhere 等）表达的判据，" +
        "没有先手算成布尔值或计数，再交给 isTrue 或 equals(true)。")
        .score(1).label("判据写在 Match 上");
      reviewEvalTaste().judge(
        "只看 evals/ 下 agent 写的 Eval 文件。缺失的数据（缺记录、缺 token、解析失败）保留为不可判定或直接报错，" +
        "没有补成 0、false 或空字符串后继续判分。")
        .score(1).label("未知保持未知");
      reviewEvalTaste().judge(
        "只看 evals/ 下 agent 写的 Eval 文件。后续检查依赖的前提（如本轮成功、服务可达）不算时，用 orStop 或等价方式停下，" +
        "不在前提已失败时继续给依赖它的项判分。没有这种依赖关系时满足。")
        .score(1).label("前提失败即停");
    });

    // 零分门槛：任何一项不算，后面的运行与取证都没有意义。
    const at = await t.group("安装与 dry plan", async () => {
      await t.check(root, isDefined<string | null>()).gate().label("niceeval.config.ts 存在").orStop();
      const at = root!;

      const installed = await t.sandbox.runCommand(
        "node", ["-p", "require('./node_modules/niceeval/package.json').version"], { cwd: at },
      );
      await t.check(installed.stdout.trim(), equals(version)).gate()
        .label(`项目依赖精确为 niceeval@${version}`).orStop();

      const list = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["list"], { cwd: at });
      await t.check(list, commandSucceeded()).gate()
        .label("项目内 CLI discovery 成功").orStop();

      const dry = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["exp", "--dry", "--json"], { cwd: at });
      await t.check(dry, commandSucceeded()).gate()
        .label("exp --dry --json 成功").orStop();
      const plan = JSON.parse(dry.stdout) as { matrix?: unknown[] };
      await t.check(plan.matrix, isDefined<unknown[] | undefined>()).gate()
        .label("dry plan 提供 matrix").orStop();
      await t.check(plan.matrix!.length, greaterThan(0)).gate()
        .label("dry plan 包含可运行的格子").orStop();
      return at;
    });

    await t.group("真实运行与公开证据", async () => {
      // 当前格的结果允许来自不同轮次；历史 Run 保留，不只挑最后一轮的第一条。
      const shell = (script: string) => t.sandbox.runShell(script, { cwd: at });
      const runs = (await query(shell, { kind: "run.list" })).runs;
      await t.check(runs.length, greaterThan(0)).gate().score(6)
        .label("agent 真实运行过自己的 Experiment").orStop();
      const latestMembers = new Map<string, { experimentId: string; evalId: string; locator: string | null; verdict: string | null }>();
      // Run 是完成证据；未声明 behaviorRevision 的合法 Adapter 不会产生可沿用 current。
      // 按开始时间覆盖同一格/采样位置，后续失败或未发布成员不能被较早成功掩盖。
      const orderedRuns = [...runs].sort((a, b) => {
        const time = (run: { startedAt: string | number }) => {
          const value = typeof run.startedAt === "number" ? run.startedAt : Date.parse(run.startedAt);
          if (!Number.isFinite(value)) throw new Error("run.list 缺少有效 startedAt，无法确定最新结果");
          return value;
        };
        return time(a) - time(b);
      });
      for (const run of orderedRuns) {
        const id = run.runId ?? run.id;
        if (typeof id !== "string") throw new Error("run.list 缺少 Run ID");
        const doc = await query(shell, { kind: "run.get", runId: id });
        if (!Array.isArray(doc?.run?.plannedAttempts)) throw new Error("run.get 缺少 plannedAttempts，无法读取运行成员");
        for (const attempt of doc.run.plannedAttempts) {
          const ordinal = attempt.attemptOrdinal ?? attempt.attempt;
          if (typeof attempt.evalId !== "string" || !Number.isSafeInteger(ordinal)) throw new Error("run.get 缺少 Eval 或 Attempt ordinal，无法确定最新成员");
          const experimentId = run.experimentId;
          if (typeof experimentId !== "string") throw new Error("run.list 缺少 experimentId");
          const memberKey = JSON.stringify([experimentId, attempt.evalId, ordinal]);
          if (attempt.relation !== "reference" || !latestMembers.has(memberKey)) {
            latestMembers.set(memberKey, {
              experimentId, evalId: attempt.evalId,
              locator: attempt.publication?.attemptLocator ?? null,
              verdict: attempt.verdict ?? attempt.publication?.verdict ?? null,
            });
          }

        }
      }
      const attempts = [...latestMembers.values()];
      await t.check(attempts.length, greaterThan(0)).gate()
        .label("当前格包含 Attempt").orStop();
      await t.check(attempts.map((attempt) => attempt.locator !== null), countWhere(equals(true), equals(attempts.length)))
        .gate()
        .label("当前格的所有 Attempt 均已发布").orStop();

      // 协议对不对，只看源码证明不了，能证明的是真实运行收到了目标响应，所以协议分并入这一项。
      const reviewExecution = () => {
        const review = t.agentJudge(tasteReviewer, { installRoot: at, attempts });
        review.chat("agent 在 installRoot 下运行过自己的 Experiment，attempts 是当前各格的 locator 与 verdict。在 installRoot 下先读该版本的 `node_modules/niceeval/INDEX.md` 与公开 CLI 帮助，再用该版本支持的 show/view/query 定位各 Attempt、execution 和 source；旧版的 `show <locator> --execution`、`--source` 与新版的 `show <locator> execution`、`source` 都是等价公开入口。");
        return review;
      };
      reviewExecution().judge(
        "至少一个正向核心用例的 execution 中，有来自 DB-GPT 真实 HTTP 入口 JSON/SSE 响应、由 Adapter 解析得到的具体数据问答结果；" +
        "结果出现在助手消息、工具结果事件或 Adapter 交付的结构化数据中都算，Adapter 把 chart-view 等结果块转成事件或数据而不放进正文不扣分。" +
        "其它当前结果若是预期负例，合法错误或拒答不因缺少正向业务内容而单独不算。" +
        "源码或 execution 显示用 stub/mock/fake/echo agent、临时协议桩或进程内函数替代真实 DB-GPT 时不算；仅有静态文字、输入回显、启动日志或 status 不算。")
        .gate(1).score(10).label("execution 含 DB-GPT 的真实响应");
      reviewExecution().judge(
        "逐项审阅所有当前 Attempt，全部满足才算。agent 写的 Adapter 与 Eval 能解释各 execution 中的输入、事件与断言结果，" +
        "包括预期负例的拒答或合法错误。任一面空白或两者对不上不算。")
        .score(6).label("source 能解释 execution");
      t.check(attempts.map((attempt) => attempt.verdict), countWhere(or(equals("passed"), equals("failed")), equals(attempts.length)))
        .score(3).label("Attempt 形成 passed 或 failed，而不是 errored");
      t.judge({ attempts, handoff: handoff.reply }, binaryJudge({ rubric:
          "attempts 是 agent 各格的当前结果。最终回复给出这些结果的 locator 或覆盖它们的可复现查看命令，" +
        "说明主要文件，并与 attempts 的 verdict 一致地报告通过、失败或局限。按目标版本 INDEX/公开帮助支持的等价入口判断：带具体 Run ID 的旧版 `niceeval show --run <id>` / `view --run <id>`、新版 `show run:<id>` / `view run:<id>`，或该版本等价的固定 query 请求，都算可复现查看命令；" +
        "只给 Run ID 而没有命令、只写不带 ID 的泛化 show 命令、指向 README 里的步骤，或把 failed/errored/替代物说成全绿，不算。" }))
        .score(3).label("交接引用 locator 并如实报告");
      t.check(attempts.map((attempt) => attempt.verdict), countWhere(equals("passed"), equals(attempts.length)))
        .score(1).label("agent 自写 Eval passed（弱证据）");
    });
  },
});
