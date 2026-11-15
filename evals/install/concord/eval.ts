/** Concord 安装保留题：评 Codex 使用 Concord 指引的开发流程。结构复制自 GPT Researcher 安装题。 */
import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { binaryJudge, commandSucceeded, countWhere, defineAgentJudge, equals, greaterThan, isDefined } from "niceeval/expect";
import { command, gitCheckout, sandboxRequirements, shell } from "niceeval/sandbox";
import { firstTurnQuestions, firstTurnWrittenNotes } from "../first-turn.ts";
import { candidateInitDocUrl } from "../docs.ts";
import { currentAttempts, query } from "../../../lib/query.ts";

const reviewer = defineAgentJudge({
  instructions: "你在评审 Concord 仓库里的 NiceEval 接入，自己读文件和运行只读命令取证。Concord 没有 AI 入口，被测对象是使用 Concord 指引的 Codex。不得读取 .niceeval 私有文件或 NiceEval 实现源码；结果只走安装版本支持的公开 show/query/view。不得读取或输出凭据实际值，不替 agent 补做运行。",
});
const owner = defineSimulatedUser({
  instructions: "你是 Concord 仓库维护者，刚让 agent 安装 NiceEval。只回答被问到的事，未决定的让它依据仓库与随包文档判断。已决定：" +
    "评估 Concord 随包 docs/skill：装了 Concord 并按指引工作的 Codex，是否比没有指引的 Codex 更能按 Concord 流程开发。Concord 没有 AI 入口，不需要也不应该为 Concord 写 Adapter。" +
    "被测 Codex 使用 NiceEval 内置 Codex Sandbox Agent。模型和凭据来自 /opt/fixture-secrets/target-app.env 中的 OPENAI_API_KEY、OPENAI_BASE_URL、TARGET_APP_MODEL，只能运行时注入 Sandbox，不能输出、复制进工作区或提交。" +
    "机器有 Docker，可以联网拉镜像、按 Concord 官方方式安装或从源码构建。最关心先改 Spec 再实现、测试和代码关联 Use Case、交付前跑通 concord check。" +
    "选 Tier 1，首跑不接 OTel/OTLP，没有可用 Judge key。可以自主运行、诊断、修复和重试，不限制格数、Attempt 数和轮次，无需再申请授权，实际成本计入评估。",
});

export default defineScoreEval({
  description: "为 Codex 使用 Concord 随包指引建立真实开发任务与对照实验",
  tags: ["install", "concord"],
  timeoutMs: 85 * 60 * 1000,
  sandbox: sandboxRequirements({})
    .before(shell({
      id: "concord-bun-1-4-4",
      user: "root",
      command: "set -eu; concord_bun_dir=$(mktemp -d); trap 'rm -rf \"$concord_bun_dir\"' EXIT; curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64.zip -o \"$concord_bun_dir/bun.zip\"; unzip -q \"$concord_bun_dir/bun.zip\" -d \"$concord_bun_dir\"; install -m 755 \"$concord_bun_dir/bun-linux-x64/bun\" /usr/local/bin/bun; bun --version",
    }))
    .before(gitCheckout({ id: "concord-checkout", repository: "https://github.com/CorrectRoadH/Concord.git", ref: "17a161f27e072d6f01270d01acac890135b61bec", to: "." }))
    .before(command("rm", ["-rf", ".git"], { id: "drop-upstream-git" }))
    .before(command("git", ["init", "-q"], { id: "git-init" }))
    .before(command("git", ["add", "-A"], { id: "git-add-baseline" }))
    .before(command("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"], { id: "git-commit-baseline" })),
  async test(t) {
    const version = t.flags.candidateVersion;
    if (typeof version !== "string") throw new Error("candidateVersion 必须是字符串");
    const firstTurn = await t.send(`READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\nUse niceeval@${version} exactly.`);
    const firstRound = { turn: firstTurn, writtenNotes: await firstTurnWrittenNotes(t.sandbox), questions: firstTurnQuestions(firstTurn) };
    await t.group("首轮理解", async () => {
      t.judge(firstRound, binaryJudge({ rubric: "只看首轮：首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明。是否说明 Concord 是没有 AI 入口的开发工具，被测的是 Codex 在 Concord 随包指引下的开发行为？打算给 Concord 写 HTTP/CLI Adapter 的不算。" }))
        .score(2).label("认清评估对象");
      t.judge(firstRound, binaryJudge({ rubric: "只看首轮：首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明。是否至少说明三项 Concord 指引要求：先改 Spec 再实现、代码和测试用 Concord 标记关联 Use Case、交付前运行 concord check、术语遵循 concepts.md？并且本轮命令可见读过 Concord skill 文件或 --skill 输出，两项都须满足。" }))
        .score(2).label("核对 Concord 指引的要求");
      t.judge(firstRound, binaryJudge({ rubric: "只看首轮：首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明。是否提出至少一个具体任务，在受 Concord 管理的项目里改一个行为或修一个缺陷，并说明怎么判断 Codex 是否按流程完成？泛泛说测文档或问答不算。" }))
        .score(2).label("提出核心用例");
      t.judge(firstRound, binaryJudge({ rubric: "只看首轮：首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明。在编写 Adapter、Experiment 或 Eval 之前是否询问 Judge 服务、模型或 Key，或说明没有 Judge 时先只写精确判据？安装依赖、niceeval init 不算动手实现。" }))
        .score(1).label("询问 Judge");
      t.judge(firstRound, binaryJudge({ rubric: "只看首轮：首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明。在真实运行 Experiment 之前是否询问首跑 Attempt 数、时间或费用预算？安装依赖、写源码、--dry 不花预算，不算。" }))
        .score(1).label("询问首跑预算");
      t.judge(firstRound, binaryJudge({ rubric: "只看首轮：首轮对话、writtenNotes 与原生提问（questions）都算 agent 本轮的说明。在编写 Adapter、Experiment 或 Eval 之前是否明确停下，把需要用户决定的选择留给用户？首轮进入 waiting 且提出了需要用户决定的问题也算停下，普通文本请求确认也算；此前安装依赖、niceeval init、读仓库与文档不算动手，只反问本应查明的事实不算。" }))
        .score(1).label("首轮停下等用户决定");
    });
    const user = t.simulatedUser(owner);
    let answered = firstTurn.status === "waiting" ? 1 : 0;
    let handoff = await user.reply(firstTurn);
    while (handoff.status === "waiting" && answered < 6) {
      handoff = await user.reply(handoff);
      answered++;
    }
    t.note("HITL 回答次数", { answered, firstReplyWasHITL: firstTurn.status === "waiting", stillWaiting: handoff.status === "waiting" });
    const configPath = (await t.sandbox.runShell("find . -maxdepth 3 -name niceeval.config.ts -not -path '*/node_modules/*' | head -1")).stdout.trim();
    const root = configPath === "" ? null : configPath.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
    const review = t.agentJudge(reviewer, { installRoot: root, handoff: handoff.reply });
    review.chat("baseline 是 agent 动手前的唯一提交。用 git status 和 git diff 列出新增或修改的 Experiment、Eval、工作区准备源码及其导入，再逐项取证。先评源码；安装或运行失败不抹掉源码证据。");
    await t.group("实验设计", async () => {
      review.judge("至少一组基线和一组处理 Experiment，两组 Codex 模型、推理设置、Eval 集合和 Concord 版本相同，唯一差别是是否提供 Concord 随包 skill/AGENTS 指引；无指引组不能仍从工作区 AGENTS 或 skill 获得同样指引。")
        .score(3).label("对照只差随包指引");
      review.judge("Sandbox 安装的 Concord 锁定具体版本或提交，不能安装不固定的 latest/master。")
        .score(1).label("Concord 版本固定");
      review.judge("内层 Codex key、base URL 和 model 都从 env 文件在运行时读取并注入 Sandbox，没有写死在源码中，不打印凭据、不把凭据文件复制进工作区。")
        .score(2).label("凭据运行时注入");
    });
    await t.group("评估题质量", async () => {
      review.judge("内层 Codex 获得受 Concord 管理的真实项目：有 Feature、Use Case、concepts.md 或等价结构；任务是改行为或修缺陷，不是问答。")
        .score(2).label("工作区真实");
      review.judge("Eval 用真实命令退出码和文件内容确定性检查 concord check、项目测试、Use Case 文件改动和测试标记，不能只看 Codex 回复或把这些事实交给语义 Judge。")
        .score(3).label("确定性检查流程结果");
      review.judge("至少一条判据会在 Codex 跳过 Spec 直接改代码时失败，例如要求对应 Use Case 文件有改动并要求新测试带指向它的 Concord 标记；只检查测试与 concord check 通过而无流程约束不算。")
        .score(3).label("判据能区分");
      review.judge("至少两个任务覆盖不同 Concord 流程，例如新增行为与修复缺陷；同一任务改两个参数不算。")
        .score(2).label("覆盖不同流程");
      review.judge("只读 Eval 正文就能看出测什么、每项通过条件，关键数量和门槛平铺在检查处，没有藏进辅助函数。")
        .score(1).label("判据平铺在打分处");
      review.judge("缺记录、缺文件、命令失败或解析失败保留为不可判定或报错，不能补成零、false 或空字符串后继续按已知事实判分。预期拒绝场景明确检查缺文件属于已知失败，不要求一律抛错。")
        .score(1).label("未知保持未知");
    });
    await t.group("宿主安装规范", async () => {
      const installed = JSON.parse(await t.sandbox.readText("package.json"));
      t.check(installed.devDependencies?.niceeval, equals(version)).gate().label("根目录精确声明候选开发依赖");
      t.check(installed.packageManager, equals("bun@1.4.4")).gate().label("保留 bun packageManager");
      t.sandbox.notInDiff(/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/m, { content: "none" }).gate().label("不引入其它包管理器锁文件");
      t.sandbox.notInDiff(/^[\w.@-]+(\/[\w.@-]+)*\/(package\.json|bun\.lockb?)$/m, { content: "none" }).gate().label("不另建子目录 Node 项目和锁文件");
      const cliVersion = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["--version"]);
      await t.check(cliVersion, commandSucceeded()).gate().label("根目录本地 CLI 可执行").orStop();
      t.check(cliVersion.stdout.trim(), equals(version)).gate().label("根目录 CLI 是指定候选版本");
      await t.check(await t.sandbox.runCommand("bun", ["install", "--frozen-lockfile"]), commandSucceeded()).gate().label("冻结锁安装成功").orStop();
      t.check(await t.sandbox.runCommand("bun", ["run", "typecheck"]), commandSucceeded()).gate().label("原有 typecheck 仍通过");
      t.check(await t.sandbox.runCommand("bun", ["run", "concord", "check"]), commandSucceeded()).gate().label("原有 concord check 仍通过");
    });
    await t.check(root, equals(".")).gate().label("根目录拥有 NiceEval 配置").orStop();
    const list = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["list"]);
    await t.check(list, commandSucceeded()).gate().label("CLI discovery 成功").orStop();
    const dry = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["exp", "--dry", "--json"]);
    await t.check(dry, commandSucceeded()).gate().label("dry plan 成功").orStop();
    const plan = JSON.parse(dry.stdout) as { matrix?: { evalId: string; experimentId: string }[] };
    await t.check(plan.matrix, isDefined<typeof plan.matrix>()).gate().label("dry 提供 matrix").orStop();
    const matrix = plan.matrix!;
    await t.check(new Set(matrix.map((cell) => cell.evalId)).size, greaterThan(0)).gate().label("发现至少一个 Eval").orStop();
    await t.check(new Set(matrix.map((cell) => cell.experimentId)).size, greaterThan(1)).gate().label("发现至少两个 Experiment").orStop();
    const experiments = await t.sandbox.runCommand("./node_modules/.bin/niceeval", ["exp", "list", "--json"]);
    await t.check(experiments, commandSucceeded()).gate().label("公开 Experiment discovery 成功").orStop();
    const discovered = JSON.parse(experiments.stdout) as { experiments: { adapter: string }[] };
    t.check(discovered.experiments.map((experiment) => experiment.adapter), countWhere(equals("codex"), equals(discovered.experiments.length))).gate().label("每个 Experiment 使用 Codex adapter");
    const sourceCheck = await t.sandbox.runShell(`python3 - <<'PY'
import pathlib,re,subprocess,json
paths=set(subprocess.check_output(['git','diff','--name-only','HEAD','-z']).decode().split('\\0'))
paths.update(subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z']).decode().split('\\0'))
texts=[pathlib.Path(p).read_text() for p in paths if p and pathlib.Path(p).is_file() and pathlib.Path(p).suffix in {'.ts','.tsx','.js','.mjs','.cts','.mts'}]
print(json.dumps({'customAgentDefinitions':sum(len(re.findall(r'\\bdefineAgent\\s*\\(',s)) for s in texts),'builtinCodexImports':sum(len(re.findall(r'import\\s*\\{[^}]*\\bcodexAgent\\b[^}]*\\}\\s*from\\s*[\\\'"]niceeval/adapter[\\\'"]',s)) for s in texts)}))
PY`);
    await t.check(sourceCheck, commandSucceeded()).gate().label("Adapter 源码取证成功").orStop();
    const adapters = JSON.parse(sourceCheck.stdout);
    t.check(adapters.customAgentDefinitions, equals(0)).gate().label("没有自定义 defineAgent");
    t.check(adapters.builtinCodexImports, greaterThan(0)).gate().label("源码从内置入口导入 Codex");
    // 凭据只在 Sandbox 内扫描进程里读取，输出只有命中数，不把 key 传回作者或 Judge。
    const secrets = await t.sandbox.runShell(`python3 - <<'PY'
import pathlib,subprocess,shlex,json
env={}
for line in pathlib.Path('/opt/fixture-secrets/target-app.env').read_text().splitlines():
 k,_,v=line.partition('=')
 env[k]=shlex.split(v)[0]
key=env['OPENAI_API_KEY'].encode()
if not key: raise RuntimeError('missing key')
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).split(b'\\0')
hits=0
for p in paths:
 if not p: continue
 path=pathlib.Path(p.decode())
 if path.is_file() and key in path.read_bytes(): hits+=1
diff=subprocess.check_output(['git','diff','HEAD'])
print(json.dumps({'workspaceHits':hits,'diffHits':int(key in diff)}))
PY`);
    await t.check(secrets, commandSucceeded()).gate().label("凭据泄漏检查执行成功").orStop();
    t.check(JSON.parse(secrets.stdout), equals({ workspaceHits: 0, diffHits: 0 })).gate().label("凭据未写入工作区或 diff");
    await t.group("真实运行与交接", async () => {
      const shell = (script: string) => t.sandbox.runShell(script);
      const runs = (await query(shell, { kind: "run.list" })).runs;
      await t.check(runs.length, greaterThan(0)).gate().label("真实运行过 Experiment").orStop();
      const attempts = currentAttempts(await query(shell, { kind: "project.get" }));
      await t.check(attempts.length, greaterThan(0)).gate().label("当前格包含 Attempt").orStop();
      await t.check(attempts.map((attempt) => attempt.locator), countWhere(isDefined(), equals(attempts.length))).gate().label("所有当前 member 都发布 Attempt").orStop();
      const executions = await t.sandbox.runShell(`python3 - <<'PY'
import json,subprocess
attempts=json.loads(${JSON.stringify(JSON.stringify(attempts))})
confirmed=set()
for a in attempts:
 p=subprocess.run(['./node_modules/.bin/niceeval','show','@'+a['locator'].lstrip('@'),'execution','--json'],capture_output=True,text=True)
 if p.returncode: raise RuntimeError('public execution unavailable')
 d=json.loads(p.stdout)
 if d.get('outcome') != 'success' or d.get('issues'): raise RuntimeError('public execution evidence unavailable')
 trace=d.get('trace')
 if trace is None: raise RuntimeError('public execution trace missing')
 items=trace.get('conversation',{}).get('items',[])
 if any(i.get('kind')=='tool-call' and i.get('tool') in ['command_execution','exec_command','shell','shell_command','apply_patch'] for i in items): confirmed.add(a['experimentId'])
print(json.dumps({'executedExperiments':len(confirmed)}))
PY`);
      await t.check(executions, commandSucceeded()).gate().label("公开 execution 取证成功").orStop();
      t.check(JSON.parse(executions.stdout).executedExperiments, greaterThan(1)).gate().label("至少两组 Experiment 有 Codex 实际开发动作");
      t.judge({ attempts, handoff: handoff.reply }, binaryJudge({ rubric: "最终回复给出当前结果 locator 或覆盖它们的带固定 Run ID 的可复现查看命令，说明主要文件，与 attempts 的 verdict 一致报告通过、失败和局限。旧版 show --run <id>、新版 show run:<id> 或固定 query 都接受。仅给 Run ID 没命令、泛化 show、不一致地说全绿均不算。" }))
        .score(3).label("交接引用 locator 并如实报告");
      const evidence = t.agentJudge(reviewer, { attempts, handoff: handoff.reply });
      evidence.chat("从候选 INDEX 和公开 CLI 帮助定位所有当前 Attempt 的 overview/execution，逐项核对两组实际样本与报告。不得替 agent 补做运行。");
      evidence.judge("对比报告基线与处理组的实际结果差异时写明样本量；单次 Attempt 差异不宣称成因果结论，未覆盖或 errored 保留为局限。仅说设计而未报告两组实际结果差异不算。")
        .score(2).label("对比结论有节制");
    });
  },
});
