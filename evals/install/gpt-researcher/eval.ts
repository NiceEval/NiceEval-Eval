import { tasteReviewer } from "../../judges/niceeval-taste.ts";
import { scopeAndCostReviewer } from "../../judges/scope-and-cost.ts";
import { appropriateQuestionsReviewer } from "../../judges/appropriate-questions.ts";
import { sessionEvidence } from "../../judges/session-evidence.ts";
import { simulatedUserDiscipline } from "../../users/discipline.ts";
/**
 * GPT Researcher install：候选 INIT.md + 随包文档能否把 coding agent 带到真实、可复审的 NiceEval 接入。
 *
 * 分数是 Adapter、Experiment、Eval、真实证据与首轮理解的自然价值累加，不设总分上限，
 * 也不为必要但无区分度的安装事实发分：精确版本、config、CLI discovery、有效 dry plan、
 * 交接 locator 和取证命令只做 gate。源码先评，安装或运行失败不会抹掉源码证据。
 */

import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { commandSucceeded, countWhere, equals, greaterThan, isDefined, or, referencesAnyPath, toolMatch, binaryJudge } from "niceeval/expect";
import { command, gitCheckout, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { firstTurnQuestions, firstTurnWrittenNotes } from "../first-turn.ts";
import { candidateInitDocUrl, ONLINE_MAIN_DOC_REFERENCES } from "../docs.ts";
import { query } from "../../../lib/query.ts";

const ROOT_TOOLING = new URL("../../../fixtures/install/gpt-researcher-root-tooling/", import.meta.url);
const ORIGINAL_WORKSPACE = parseYaml(readFileSync(new URL("pnpm-workspace.yaml", ROOT_TOOLING), "utf8"));

/** 评审者：在被测 Sandbox 里自己读文件、跑命令取证，同一会话里逐题打分。*/

/** 模拟用户：仓库维护者已经拿定的决定。只回答 agent 问到的事，没决定过的交还给它自己判断。*/
const owner = defineSimulatedUser({
  instructions: `${simulatedUserDiscipline}
身份：你是 GPT Researcher 仓库维护者，刚请对方接入 NiceEval。
已决定事实：选 Tier 1，首跑不接 OTel 或 LangSmith，没有可用的 Judge key。模型取 /opt/fixture-secrets/target-app.env 的 TARGET_APP_MODEL（出口只支持它），用内置 DuckDuckGo，不做 experiment flags。凭证仅注入目标服务进程，不输出、不提交、不复制进工作区。OPENAI_EXTRA_HEADERS 是 JSON 对象，包含 Cloudflare Access 头，运行时读取并随每次 LLM 请求发送。机器可联网，可按上游方式安装依赖或拉取镜像。
未决定事项：研究任务、Adapter 和评估写法由对方依据仓库和随包文档确定。
压力与反应：可自主运行、诊断、修复和重试，不限制格数、Attempt 数或轮次，无需再申请运行授权；实际成本计入评估。`,
});

export default defineScoreEval({
  description: "把 niceeval 接入 GPT Researcher，复用已有根目录 pnpm 工具链",

  timeoutMs: 80 * 60 * 1000,
  sandbox: sandboxRequirements({})
    .before(gitCheckout({
      id: "gpt-researcher-checkout",
      repository: "https://github.com/assafelovic/gpt-researcher.git",
      ref: "5d84d2f5553e70a2765a8ff3a0d2672d60437ce8",
      to: ".",
    }))
    .before(uploadDirectory({
      id: "root-tooling",
      source: ROOT_TOOLING,
      to: ".",
    }))
    // 重建一个只有一次 baseline 提交的仓库：agent 面对的是普通 git 项目，评审用 git status / git diff 看它改了什么。
    .before(command("rm", ["-rf", ".git"], { id: "drop-upstream-git" }))
    .before(command("git", ["init", "-q"], { id: "git-init" }))
    .before(command("git", ["add", "-A"], { id: "git-add-baseline" }))
    .before(command("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"], { id: "git-commit-baseline" }))
    // Fixture 的依赖和原有检查先通过，后续失败才能归因于安装改动；任一步失败就是准备失败。
    .before(command("pnpm", ["install", "--frozen-lockfile"], { id: "baseline-install" }))
    .before(command("pnpm", ["run", "check"], { id: "baseline-check" })),
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
        "agent 是否说清它选用的 GPT Researcher 入口与协议形状，并且本轮命令里能看到它读过定义这个入口的源码？" +
        "仓库里有多条真实入口，例如 FastAPI /ws（发送 `start ` + JSON，返回 logs/images/report/path 帧）和 REST POST /report/（返回含 report 字段的 JSON），选哪条都可以。" +
        "只说“调 API”、猜成 OpenAI messages 接口，或说出的入口在命令读过的源码里找不到，不算。" }))
        .score(2).label("核对接入协议");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否说明核心能力是自主检索多源资料并生成带引用的结构化研究报告，而不是普通对话。" }))
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
        "agent 是否主动提出了一条具体的首个 Eval 核心用例：对具体主题自主检索多源资料，产出带引用来源的结构化研究报告正文。仅提 hello、任务提交回执或非空回复不算。" }))
        .score(2).label("提出核心用例");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否说明了这条用例可观察的业务成功结果，例如检查主题相关实质内容、结构化章节和引用 URL？" }))
        .score(1).label("说明成功判据");
      t.judge(firstRound, binaryJudge({ rubric:
          "只看首轮（首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明）：" +
        "agent 是否指出了主要失败风险，例如虚构主题被写成看似有据的报告？" }))
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
    // 四个源码评审会话共用开场。最长判据单独取证，其余按历史耗时分摊。
    const sourceReviewIntro = "正在评审 GPT Researcher 的 NiceEval 接入。 installRoot 是 niceeval.config.ts 所在目录。仓库的 baseline 提交是 agent 动手前的状态，用 git status 与 git diff 看它改了什么。先列出 agent 写的 Adapter、Experiment、Eval 文件，以及它们 import 的项目文件。";
    const reviewReportMapping = t.agentJudge(tasteReviewer, { installRoot: root, handoff: handoff.reply });
    reviewReportMapping.chat(sourceReviewIntro);
    const reviewEval = t.agentJudge(tasteReviewer, { installRoot: root, handoff: handoff.reply });
    reviewEval.chat(sourceReviewIntro);
    const reviewConfiguration = t.agentJudge(tasteReviewer, { installRoot: root, handoff: handoff.reply });
    reviewConfiguration.chat(sourceReviewIntro);
    const questions = t.agentJudge(appropriateQuestionsReviewer, { questions: session.questions(), context: "安装版本已经由题面给定；研究任务与可用搜索条件需由用户确认。" });
    questions.judge("agent 的提问澄清了希望评估的实际研究任务或允许使用的搜索条件。").score(1).label("提问得当");
    const reviewService = t.agentJudge(tasteReviewer, { installRoot: root, handoff: handoff.reply });
    reviewService.chat(sourceReviewIntro);
    reviewConfiguration.judge(
      "安装复用已有根目录 pnpm 开发工具项目，交接说明从仓库根目录运行的本地命令。" +
      "仅因为 Python 服务而创建独立 niceeval/package.json、第二套锁文件或要求用户猜测 cd 目录，不算。")
      .score(3).label("安装融入宿主工具链并交付根目录入口");
    await t.group("Adapter、Experiment 与 Eval 源码设计", async () => {
      reviewReportMapping.judge(
        "NiceEval 助手消息或标准事件的最终文本是 GPT Researcher 本次任务生成的报告正文：来自 /ws 的 report 帧、" +
        "POST /report/ 返回的 report 字段，或 path 指向的本次报告文件；进度日志、图片和 path 本身按各自语义处理，不当成报告。" +
        "返回输入原文、固定 ASSISTANT 文字或仅说任务已提交不算。")
        .score(6).label("真实报告映射为 NiceEval 消息或事件");
      reviewConfiguration.judge(
        "Adapter/lifecycle 真正读取所选静态研究配置（如 report_type、tone、report_source），并把它们传入 GPT Researcher 请求或目标进程。" +
        "只在 Experiment 声明但没有读取，或全部被硬编码，不算。model 是否被消费不在本项判断。")
        .score(3).label("研究配置传到 GPT Researcher");
      reviewService.judge(
        "send 把 NiceEval AbortSignal 或等价取消机制传给WebSocket/HTTP 连接，并设置有界超时。")
        .score(1).label("取消与超时");
      reviewService.judge(
        "在连接失败、非正常 close、帧解析错误、error 帧或未收到 report时抛出或映射为失败。catch 后改返成功空文本或吞错不算。")
        .score(2).label("错误不被吞掉");
      reviewConfiguration.judge(
        "LLM/搜索凭证只从环境/目标服务进程边界读取，不硬编码，不写入工作区，不打印，也不混入 Eval 文本或取证输出；" +
        "/opt/fixture-secrets/target-app.env 只注入目标服务进程，不 source 到 agent shell。")
        .score(2).label("凭证边界正确");
      reviewEval.judge(
        "至少一条 Eval 把一个具体、可研究的主题交给 GPT Researcher 的研究报告路径（请求里的 report_type 是研究报告类），" +
        "让它自主检索资料并返回报告正文。输入只需要给出主题：多源检索、章节和引用是 GPT Researcher 自己的行为，" +
        "有没有做到由断言项判断，不要求写进输入文本。" +
        "把研究限定在输入给定的单一来源、禁止检索，或 hello、自我介绍、无关常识，不算。")
        .score(6).label("输入覆盖 GPT Researcher 核心能力");
      reviewEval.judge(
        "断言检查主题相关的实质结论、可识别的报告结构，以及一个或多个可审查的来源 URL/引用。" +
        "只检查 succeeded、任务提交回执、非空文本、字数或“报告”字样不算。")
        .score(6).label("断言检查报告内容、结构与引用");
      reviewEval.judge(
        "Eval 包含一个虚构且不可能有可靠来源的具体主题，并断言系统不得编造引用或写成看似有据的报告。" +
        "prompt 若直接教它标准拒答，或只把网络失败当负例，不算。")
        .score(4).label("真实负例暴露引用编造风险");
      reviewEval.judge(
        "对可有多种正确章节、结论与引用措辞的报告使用语义 Judge、解析后的 Markdown/引用 URL 结构检查或宽容 matcher。" +
        "仅匹配一个脆弱短语、完整原文或和业务无关的长度不算。")
        .score(3).label("开放报告使用稳健判断");
      reviewService.judge(
        "Eval 只描述研究任务和断言，没有在单条 test 用例内自行启动、伪造、重启或代管 GPT Researcher 全局服务。" +
        "服务生命周期位于项目级命令准备或 Experiment/Plugin/Sandbox 层面才算。")
        .score(2).label("Eval 不代管目标服务");
      reviewConfiguration.judge(
        "Experiment 实际选择本次 GPT Researcher Adapter，且它选中的 Eval 测试的也是该研究系统，" +
        "而不是内置/通用/echo agent 或无关 Eval。Adapter 要能从 Experiment 的导入追到定义；Eval 的选择按 NiceEval 的规则判断：" +
        "`evals` 里的 ID 或路径前缀选中对应文件，省略 `evals` 表示选中 evals/ 下全部 Eval，不要求 Experiment 导入 Eval 文件。")
        .score(5).label("使用本次 GPT Researcher Adapter 与目标 Eval");
      reviewConfiguration.judge(
        "Experiment 声明的每个 model、flags 或静态配置都有清楚的消费方：Adapter/lifecycle 读取后传给 GPT Researcher。" +
        "配了值却没有任何读取点、只改显示名或被硬编码覆盖不算。用户指定目标模型取自凭证文件里的 TARGET_APP_MODEL、不做 model 维度，所以 Experiment 不声明 model 或明确拒绝 model 覆盖都算正确。")
        .score(3).label("模型、flags 与静态配置不是死配置");
      reviewService.judge(
        "agent 按照 GPT Researcher 项目自身的最佳实践（如通过官方 CLI / 脚本启动、配置与健康探测，或 Experiment/Plugin lifecycle）真实启动 GPT Researcher 并确保 WebSocket/HTTP 入口就绪后才跑评测。" +
        "无任何启动与就绪动作仅盲目假定服务已就绪不算；使用假 mock 或进程内 fake 替代真实服务不算。")
        .score(2).label("目标服务启动与就绪");
      reviewService.judge(
        "在 lifecycle 或任务收尾时对启动的服务进程/容器有可靠清理或回收机制。")
        .score(1).label("目标服务清理");
    });
    await t.group("Eval 判据可读性（NiceEval Taste）", async () => {
      reviewEval.judge(
        "只看 evals/ 下 agent 写的 Eval 文件。只读 Eval 正文就能说出它测什么、每项什么算通过、分数或门槛怎么来；" +
        "关键阈值、数量和分值直接写在检查上，没有藏进辅助函数。")
        .score(1).label("正文读得出判据");
      reviewEval.judge(
        "只看 evals/ 下 agent 写的 Eval 文件。能直接读到的事实（工具名与参数、次数、文件内容、命令退出码、结构化字段）" +
        "用确定性检查，没有把这类事实交给 Judge 判断。")
        .score(1).label("事实用确定性检查");
      reviewEval.judge(
        "只看 evals/ 下 agent 写的 Eval 文件。能用现成 Match（equals、includes、pattern、toolMatch、countWhere 等）表达的判据，" +
        "没有先手算成布尔值或计数，再交给 isTrue 或 equals(true)。")
        .score(1).label("判据写在 Match 上");
      reviewEval.judge(
        "只看 evals/ 下 agent 写的 Eval 文件。缺失的数据（缺记录、缺 token、解析失败）保留为不可判定或直接报错，" +
        "没有补成 0、false 或空字符串后继续判分。")
        .score(1).label("未知保持未知");
      reviewService.judge(
        "只看 evals/ 下 agent 写的 Eval 文件。后续检查依赖的前提（如本轮成功、服务可达）不算时，用 orStop 或等价方式停下，" +
        "不在前提已失败时继续给依赖它的项判分。没有这种依赖关系时满足。")
        .score(1).label("前提失败即停");
    });

    const scope = t.agentJudge(scopeAndCostReviewer, { installRoot: root });
    scope.chat("用 baseline 后的 git diff 核对 GPT Researcher 的接入是否局限于需要的改动。");
    scope.judge("GPT Researcher 的应用改动只涉及该 NiceEval 接入所需的入口、配置和运行支持。")
      .score(1).label("应用改动限于评估接入");

    await t.group("宿主安装规范", async () => {
      // 根工具项目由 fixture 上传，原值就是 fixtures/install/gpt-researcher-root-tooling/package.json 里写的。
      const installed = JSON.parse(await t.sandbox.readText("package.json"));
      t.check(installed.devDependencies?.niceeval, equals(version)).gate()
        .label("根工具项目声明精确候选开发依赖");
      t.check(installed.packageManager, equals("pnpm@12.20.0")).gate()
        .label("保留已有 pnpm 版本");
      t.check(installed.type, equals("commonjs")).gate()
        .label("保留宿主 CommonJS 格式");
      t.check(installed.scripts?.check, equals("node scripts/check.js")).gate()
        .label("保留原有检查入口");
      t.check(installed.devDependencies?.["@gpt-researcher/repo-check"], equals("workspace:*")).gate()
        .label("保留已有 workspace 工具依赖");
      t.sandbox.unchangedWithin(["scripts/check.js", "tools/repo-check"]).gate()
        .label("保留原有检查源码");
      // 候选发布不足 minimumReleaseAge 时，`pnpm add` 会自己往 pnpm-workspace.yaml 写入该候选的豁免。
      // 这是包管理器的正常行为，不算 agent 改动 workspace 边界；除这一项外文件必须保持原样。
      const { minimumReleaseAgeExclude, ...workspace } = parseYaml(await t.sandbox.readText("pnpm-workspace.yaml")) ?? {};
      t.check({ workspace, minimumReleaseAgeExclude: minimumReleaseAgeExclude ?? [`niceeval@${version}`] },
        equals({ workspace: ORIGINAL_WORKSPACE, minimumReleaseAgeExclude: [`niceeval@${version}`] })).gate()
        .label("保留已有 workspace 边界（只容许 pnpm 写入候选的发布期豁免）");
      // 根目录的 package.json 与 pnpm-lock.yaml 本来就该改；其它目录下的 Node manifest 或锁文件一个都不该新增、修改或删除。
      // 只比较路径：大锁文件的正文会被省略，扫描变化行会让这条判定变成不可判定。
      t.sandbox.notInDiff(/^[\w.@-]+(\/[\w.@-]+)*\/(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/m, { content: "none" }).gate()
        .label("不另建或改动子目录的 Node 项目与锁文件");
      // 必须在验收方执行 install 之前检查，避免冻结安装替 agent 补装缺失的 CLI。
      const cliVersion = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "--version"], { cwd: "." });
      await t.check(cliVersion, commandSucceeded()).gate()
        .label("根目录 pnpm exec 找到本地 NiceEval").orStop();
      t.check(cliVersion.stdout.trim(), equals(version)).gate()
        .label("根目录 CLI 为指定候选版本");
      const frozen = await t.sandbox.runCommand("pnpm", ["install", "--frozen-lockfile"], { cwd: "." });
      await t.check(frozen, commandSucceeded()).gate()
        .label("根目录冻结安装成功").orStop();
      const check = await t.sandbox.runCommand("pnpm", ["run", "check"], { cwd: "." });
      t.check(check, commandSucceeded()).gate()
        .label("原有宿主检查仍通过");
    });

    // 零分门槛：任何一项不算，后面的运行与取证都没有意义。
    const at = await t.group("安装与 dry plan", async () => {
      await t.check(root, isDefined<string | null>()).gate().label("niceeval.config.ts 存在").orStop();
      await t.check(root, equals(".")).gate()
        .label("根工具项目拥有 NiceEval 配置").orStop();
      const at = root!;

      const installed = await t.sandbox.runCommand(
        "node", ["-p", "require('./node_modules/niceeval/package.json').version"], { cwd: at },
      );
      await t.check(installed.stdout.trim(), equals(version)).gate()
        .label(`项目依赖精确为 niceeval@${version}`).orStop();

      const list = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "list"], { cwd: "." });
      await t.check(list, commandSucceeded()).gate()
        .label("项目内 CLI discovery 成功").orStop();

      const dry = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "exp", "--dry", "--json"], { cwd: "." });
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
      const executionReviewIntro = "agent 在 installRoot 下运行过自己的 Experiment，attempts 是当前各格的 locator 与 verdict。在 installRoot 下先读该版本的 `node_modules/niceeval/INDEX.md` 与公开 CLI 帮助，再用该版本支持的 show/view/query 定位各 Attempt、execution 和 source；旧版的 `show <locator> --execution`、`--source` 与新版的 `show <locator> execution`、`source` 都是等价公开入口。";
      const reviewSourceAndExecution = t.agentJudge(tasteReviewer, { installRoot: at, attempts });
      reviewSourceAndExecution.chat(executionReviewIntro);
      const reviewLiveResponse = t.agentJudge(tasteReviewer, { installRoot: at, attempts });
      reviewLiveResponse.chat(executionReviewIntro);
      reviewSourceAndExecution.judge(
        "逐项审阅所有当前 Attempt，全部满足才算。agent 写的 Adapter 与 Eval 能解释各 execution 中的输入、事件与断言结果，" +
        "包括预期负例的拒答或合法错误。任一面空白或两者对不上不算。")
        .score(6).label("source 能解释 execution");
      reviewLiveResponse.judge(
        "至少一个正向核心用例的 execution 中，助手消息是 GPT Researcher 本次任务生成的报告（/ws report 帧、POST /report/ 的 report 字段或 path 指向的本次报告文件），" +
        "由 Adapter 解析得到，并呈现与 Eval 研究主题有关的实质报告内容与引用。其它当前结果若是预期负例，合法错误或拒答不因缺少正向业务内容而单独不算。" +
        "源码或 execution 显示用 stub/mock/fake/echo agent、临时协议桩或进程内函数替代真实 GPT Researcher 时不算；仅有静态文字、输入回显、启动日志或 status 不算。")
        .gate(1).score(10).label("execution 含 GPT Researcher 的真实响应");
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
