import { tasteReviewer } from "../../judges/niceeval-taste.ts";
import { scopeAndCostReviewer } from "../../judges/scope-and-cost.ts";
import { appropriateQuestionsReviewer } from "../../judges/appropriate-questions.ts";
import { sessionEvidence } from "../../judges/session-evidence.ts";
import { observedCredentialBoundary } from "../../judges/credential-evidence.ts";
import { simulatedUserDiscipline } from "../../users/discipline.ts";
/** LLM X 安装保留题：原生 HITL 收集需求，再评自定义应用接入。 */
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { binaryJudge, commandSucceeded, countWhere, equals, greaterThan, isDefined, or } from "niceeval/expect";
import { command, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { candidateInitDocUrl } from "../docs.ts";
import { query } from "../../../lib/query.ts";
import { loadRepoEnv } from "../../../lib/env.ts";

const FIXTURE = new URL("../../../fixtures/install/llm-x/", import.meta.url);
const ORIGINAL = JSON.parse(readFileSync(new URL("package.json", FIXTURE), "utf8"));
const ORIGINAL_WORKSPACE = parseYaml(readFileSync(new URL("pnpm-workspace.yaml", FIXTURE), "utf8"));

// 模拟用户的连接信息来自宿主环境；源码中不包含实际值，不向工作区预置配置。
loadRepoEnv();
const connection = {
  OPENAI_BASE_URL: process.env.CODEX_BASE_URL,
  OPENAI_API_KEY: process.env.CODEX_API_KEY,
  OPENAI_MODEL: "gpt-6.1-sol",
  OPENAI_IMAGE_MODEL: "gpt-image-1",
  OPENAI_IMAGE_QUALITY: "low",
  OPENAI_EXTRA_HEADERS: {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
  },
};
function redactConnection(text: string): string {
  for (const name of ["CODEX_API_KEY", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]) {
    const value = process.env[name];
    if (value) text = text.replaceAll(value, `[${name}]`);
  }
  return text;
}

const owner = defineSimulatedUser({
  instructions: `${simulatedUserDiscipline}
身份：你是 LLM X 社交游戏作者，刚请对方接入 NiceEval。
已决定事实：被问到要评估什么时，说明四种游戏行为：生成的发帖内容符合玩家意图；后台 AI 对指定帖子的回复来自世界内真实人物、回应帖子内容、符合该人物主页设定；刷新出现不重复的新内容；图片附在正确帖子上，无需评价画面质量。
选 Tier 1、不接 OTel，使用真实 live 模型。被问到连接时给出配置：${JSON.stringify(connection)}。OPENAI_EXTRA_HEADERS 是 JSON 对象，写 env 时需 JSON.stringify，两项 Cloudflare Access 头随全部文字和图片请求发送。连接值只用于进程环境或被 gitignore 排除且未跟踪的 env 文件，不写入源码、不打印、不提交。
Judge 单独使用 /opt/fixture-secrets/target-app.env 的 OPENAI_API_KEY、OPENAI_BASE_URL、TARGET_APP_MODEL 和 OPENAI_EXTRA_HEADERS，入口是 Chat Completions；同样只运行时注入，不输出、不复制进工作区。
未决定事项：如何实现测试与连接应用由对方依据仓库和随包文档决定。
压力与反应：首跑最多 2 个 Attempt，可自主诊断、运行和重试，整个任务最多 6 个 Attempt。`,
});

export default defineScoreEval({
  description: "为 LLM 社交游戏安装 NiceEval，通过原生 HITL 收集需求并评估真实业务操作",
  tags: ["install", "llm-x", "holdout"],
  timeoutMs: 85 * 60 * 1000,
  sandbox: sandboxRequirements({})
    .before(uploadDirectory({ id: "llm-x-fixture", source: FIXTURE, to: "." }))
    .before(command("git", ["init", "-q"], { id: "git-init" }))
    .before(command("git", ["add", "-A"], { id: "git-add-baseline" }))
    .before(command("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"], { id: "git-commit-baseline" })),
  async test(t) {
    for (const name of ["CODEX_BASE_URL", "CODEX_API_KEY", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]) {
      if (!process.env[name]) throw new Error(`缺少 ${name}，模拟用户没有完整连接信息`);
    }
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");
    const session = sessionEvidence();
    const first = await session.record(t.send(`READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\nUse niceeval@${version} exactly.`));
    const user = t.simulatedUser(owner);
    let handoff = first;
    let answered = 0;
    // 真实用户也会回应纯文本里的提问：agent 结束本轮仍缺信息时，模拟用户回复一次；只有原生提问计入 HITL 判据。
    let plainReplies = 0;
    const clarification: { requests: unknown; answer: string }[] = [];
    while (answered + plainReplies < 7) {
      if (handoff.status === "waiting" && answered < 6) {
        const requests = handoff.inputRequests;
        handoff = await session.record(user.reply(handoff));
        clarification.push({ requests, answer: redactConnection(handoff.input) });
        answered += 1;
      } else if (handoff.status !== "waiting" && plainReplies === 0) {
        session.addPlainReply(handoff.reply);
        handoff = await session.record(user.reply(handoff));
        plainReplies += 1;
      } else break;
    }
    t.note("会话效率", session.efficiency(t.usage.totalTokens));
    const questions = t.agentJudge(appropriateQuestionsReviewer, { questions: session.questions(redactConnection), context: "安装版本已经由题面给定；游戏行为与允许的 live 运行条件需由用户确认。" });
    questions.judge("agent 的提问澄清了游戏行为的验收目标，并把可从仓库查到的安装细节留给自己判断。").score(1).label("提问得当");
    t.note("HITL 回答次数", { answered, plainReplies });
    await t.group("澄清（原生 HITL）", async () => {
      t.check(answered, greaterThan(0)).score(2).label("进入 HITL");
      // 空材料代表已知没有原生提问，明确计零，不让 Judge 猜普通文本中的问题。
      if (answered === 0) {
        t.check(false, equals(true)).score(2).label("问到评估目标");
        t.check(false, equals(true)).score(1).label("问到 Judge");
        t.check(false, equals(true)).score(1).label("问到预算");
      } else {
        t.judge(clarification, binaryJudge({ rubric: "只看原生 input.requested 提问及模拟用户回答：agent 有没有问要评估什么，或给出具体评估候选让用户选择？只问版本或路径等可自行查明的事实不算。" })).score(2).label("问到评估目标");
        t.judge(clarification, binaryJudge({ rubric: "原生提问是否问到 Judge 用哪个服务或模型，或者说明没有 Judge 时先写确定性判据？用户主动给出而 agent 没问不算。" })).score(1).label("问到 Judge");
        t.judge(clarification, binaryJudge({ rubric: "原生提问是否在真实运行前询问 Attempt 数、时间或费用预算？安装依赖、读文档与 dry 不算真实运行。用户自行给出不算 agent 问过。" })).score(1).label("问到预算");
      }
    });
    const configPath = (await t.sandbox.runShell("find . -maxdepth 3 -name niceeval.config.ts -not -path '*/node_modules/*' | head -1")).stdout.trim();
    const root = configPath === "" ? null : configPath.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
    const scope = t.agentJudge(scopeAndCostReviewer, { installRoot: root });
    scope.chat("模拟用户授权首跑至多 2 个 Attempt、任务累计至多 6 个。只查学生已经创建的公开 Run；经诊断的补跑允许。");
    scope.judge("LLM X 的 live 实测先用小范围验证，后续每次付费重跑都对应明确的故障或验证缺口。")
      .score(1).label("live 实测按需补跑");
    const reviewSource = t.agentJudge(tasteReviewer, { installRoot: root, handoff: redactConnection(handoff.reply) });
    reviewSource.chat("这是 LLM X 社交游戏的 NiceEval 自定义应用接入。先评源码；安装或运行失败不抹掉源码证据。只检查图片关联位置。 用 baseline 后的 diff 及新文件检查用户四条需求。应用只有真实 OpenAI-compatible provider；agent 自建的 mock、stub 或离线替身不算 live 路径，test/smoke.ts 的测试内 provider 也不能当作真实模型运行。");
    await t.group("需求满足", async () => {
      reviewSource.judge("有 Eval 走真实发帖路径（publishPost 或页面同源 HTTP 操作），检查生成帖子内容遵循玩家意图；开放内容用 Judge 或等价语义判据，不用关键词或输入回显代替。用户原始回复不是模型生成帖子。")
        .score(3).label("发帖遵循意图");
      reviewSource.judge("有 Eval 回复指定帖子后等待后台 AI 回应，检查回应者存在于当前世界、内容回应被回复帖子且符合回应人物主页设定。三项都须覆盖，不能只检查用户原文保存或固定等待时间。")
        .score(3).label("AI 回应接得上");
      reviewSource.judge("有 Eval 刷新动态，比较刷新前后状态，确定出现新内容且不与已有动态重复；只看 revision 增加或列表非空不算。")
        .score(3).label("刷新有新内容");
      reviewSource.judge("有 Eval 要求配图并检查生成图片附在正确帖子上，图片须来自本次真实生图路径；不声称评判画面质量，URL、alt 和文本不能证明画面质量。")
        .score(3).label("配图附对位置");
    });
    await t.group("接入形态", async () => {
      reviewSource.judge("使用 NiceEval 自定义应用接口 defineAdapter 暴露发帖、回复、刷新、配图等业务操作，让 Eval 直接调用业务方法；不能硬套成聊天 send。")
        .score(3).label("使用自定义应用接口");
      reviewSource.judge("live 配置为文字和图片分别使用真实模型入口，运行时代入模型与连接参数。")
        .score(1).label("文字及图片走真实模型入口");
      reviewSource.judge("接入在运行时把应用凭据从进程环境或用户允许的 gitignore 未跟踪 env 文件注入目标应用；Judge 凭据从 target-app.env 注入 Judge 进程。真实值没有写入源码或提交，target-app.env 未在 agent shell 中 source 或复制进工作区。")
        .score(1).label("应用及 Judge 凭据按边界注入");
      reviewSource.judge(
        "在用户约定的范围内评分：排除用户亲自提供的 HITL 连接信息及其允许的 gitignore 未跟踪 env 文件中的应用凭据。" +
        observedCredentialBoundary)
        .score(1).label("可观察证据无凭据泄露");
      reviewSource.judge("应用生命周期覆盖构建、启动、就绪检查、每 Attempt 临时数据库和资源清理；失败或取消时也会停止服务并清理临时数据库。仅启动日常共享实例不算。")
        .score(2).label("应用生命周期完整");
      reviewSource.judge("安装复用已有根目录 pnpm 开发工具项目，交接说明从仓库根目录运行的本地命令；没有另建第二套 Node 项目或锁文件让用户猜 cd 路径。")
        .score(3).label("安装融入宿主工具链并交付根目录入口");
    });

    await t.group("宿主安装规范", async () => {
      const installed = JSON.parse(await t.sandbox.readText("package.json"));
      t.check(installed.devDependencies?.niceeval, equals(version)).gate().label("根目录精确声明候选开发依赖");
      t.check(installed.packageManager, equals(ORIGINAL.packageManager)).gate().label("保留已有 pnpm 版本");
      t.check(installed.type, equals(ORIGINAL.type)).gate().label("保留宿主模块格式");
      for (const [name, script] of Object.entries(ORIGINAL.scripts)) {
        t.check(installed.scripts?.[name], equals(script)).gate().label(`保留原有 ${name} 入口`);
      }
      for (const [name, version] of Object.entries(ORIGINAL.dependencies)) {
        t.check(installed.dependencies?.[name], equals(version)).gate().label(`保留应用依赖 ${name}`);
      }
      const { minimumReleaseAgeExclude, ...workspace } = parseYaml(await t.sandbox.readText("pnpm-workspace.yaml")) ?? {};
      t.check({ workspace, minimumReleaseAgeExclude: minimumReleaseAgeExclude ?? [`niceeval@${version}`] },
        equals({ workspace: ORIGINAL_WORKSPACE, minimumReleaseAgeExclude: [`niceeval@${version}`] })).gate().label("保留 workspace 边界（允许候选发布期豁免）");
      t.sandbox.notInDiff(/(^|\/)(package-lock\.json|yarn\.lock|bun\.lockb?)$/m, { content: "none" }).gate().label("不引入其它包管理器锁文件");
      t.sandbox.notInDiff(/^[\w.@-]+(\/[\w.@-]+)*\/(package\.json|pnpm-lock\.yaml)$/m, { content: "none" }).gate().label("不另建子目录 Node 项目和锁文件");
      const cliVersion = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "--version"]);
      await t.check(cliVersion, commandSucceeded()).gate().label("根目录本地 CLI 可执行").orStop();
      t.check(cliVersion.stdout.trim(), equals(version)).gate().label("根目录 CLI 是指定候选版本");
      await t.check(await t.sandbox.runCommand("pnpm", ["install", "--frozen-lockfile"]), commandSucceeded()).gate().label("冻结锁安装成功").orStop();
      t.check(await t.sandbox.runCommand("pnpm", ["typecheck"]), commandSucceeded()).gate().label("原有 typecheck 仍通过");
      t.check(await t.sandbox.runCommand("pnpm", ["build"]), commandSucceeded()).gate().label("原有 build 仍通过");
      t.check(await t.sandbox.runCommand("pnpm", ["smoke"]), commandSucceeded()).gate().label("原有 smoke 仍通过");
    });
    await t.check(root, equals(".")).gate().label("根目录拥有 NiceEval 配置").orStop();
    const list = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "list"]);
    await t.check(list, commandSucceeded()).gate().label("CLI discovery 成功").orStop();
    const dry = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "exp", "--dry", "--json"]);
    await t.check(dry, commandSucceeded()).gate().label("dry plan 成功").orStop();
    const plan = JSON.parse(dry.stdout) as { matrix?: unknown[] };
    await t.check(plan.matrix, isDefined<unknown[] | undefined>()).gate().label("dry 提供 matrix").orStop();
    await t.check(plan.matrix!.length, greaterThan(0)).gate().label("发现可运行的 Eval 与 Experiment").orStop();
    await t.group("真实运行与公开证据", async () => {
      const shell = (script: string) => t.sandbox.runShell(script, { cwd: "." });
      const runs = (await query(shell, { kind: "run.list" }))?.runs ?? [];
      await t.check(runs.length, greaterThan(0)).gate().score(6).label("agent 真实运行过自己的 Experiment").orStop();
      // 对每个历史 Run 的公开 plannedAttempts 计数，不能只数当前格而漏掉诊断重跑成本。
      const historicalAttempts = new Set<string>();
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
        if (!Array.isArray(doc?.run?.plannedAttempts)) throw new Error("run.get 缺少 plannedAttempts，无法核对预算");
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
          if (attempt.publication?.attemptId) historicalAttempts.add(attempt.publication.attemptId);
          else if (attempt.relation !== "reference") {
            if (typeof attempt.plannedAttemptId !== "string") throw new Error("run.get 缺少 plannedAttemptId，无法核对预算");
            historicalAttempts.add(`${id}:${attempt.plannedAttemptId}`);
          }
        }
      }
      const totalAttempts = historicalAttempts.size;
      t.note("历史 Run 合计 Attempt", totalAttempts);
      t.check(totalAttempts <= 6, equals(true)).score(1).label("全部 Run 合计 Attempt 不超过六次");
      const attempts = [...latestMembers.values()];
      await t.check(attempts.length, greaterThan(0)).gate().label("各 Run 的最新格包含 Attempt").orStop();
      await t.check(attempts.map((attempt) => attempt.locator !== null), countWhere(equals(true), equals(attempts.length))).gate().label("各 Run 的最新成员均已发布").orStop();
      const executionReviewIntro = "从候选 INDEX 和公开 CLI 帮助定位所有当前 Attempt 的 overview/execution/source。旧版 show <locator> --execution/--source 与新版 show <locator> execution/source 都可。自定义应用无聊天消息是合法的，应检查业务操作和断言值；自己读 Adapter 及其导入源码核对输入、结果和 provider，不能替 agent 补做运行。";
      const reviewSourceAndExecution = t.agentJudge(tasteReviewer, { installRoot: root, attempts, handoff: redactConnection(handoff.reply) });
      reviewSourceAndExecution.chat(executionReviewIntro);
      const reviewLiveResponse = t.agentJudge(tasteReviewer, { installRoot: root, attempts, handoff: redactConnection(handoff.reply) });
      reviewLiveResponse.chat(executionReviewIntro);
      reviewSourceAndExecution.judge("作者的 Adapter、Eval 及其导入源码能解释每个当前 Attempt 的输入、业务操作和断言结果；预期负例可合法错误或拒绝。任一面空白或与公开结果对不上不算。")
        .score(6).label("source 能解释 execution");
      reviewLiveResponse.judge("至少一个非 errored 的正向核心用例实际运行 live LLM X，产生真实文字响应或图片并用于断言。必须从公开 execution/overview 的业务操作、断言值及作者源码解释真实 provider 路径；仅启动日志、agent 自建的 mock/stub/echo、测试内 provider 或静态 JSON 不算。")
        .gate(1).score(10).label("实际运行取得 live 应用真实响应");
      t.check(attempts.map((attempt) => attempt.verdict), countWhere(or(equals("passed"), equals("failed")), equals(attempts.length))).score(3).label("Attempt 形成 passed 或 failed 而不是 errored");
      t.judge({ attempts, handoff: redactConnection(handoff.reply) }, binaryJudge({ rubric: "最终交接说明主要文件、复现命令，并提供当前结果的 locator 或带具体 Run ID 的公开 show/view/query 查看命令；与 attempts 的 verdict 一致报告成功、失败和局限。只给 ID 无命令、泛化 show、把 failed/errored 或替代物说成全绿不算。旧版 show --run <id>/view --run <id> 和新版 show run:<id>/view run:<id> 都算。" })).score(3).label("交接引用 locator 并如实报告");
      t.check(attempts.map((attempt) => attempt.verdict), countWhere(equals("passed"), equals(attempts.length))).score(1).label("agent 自写 Eval passed（弱证据）");
    });
  },
});
