/**
 * 评估安装（计分制 / 加分式）：一条题内叠加挣分，分从 0 往上累加、不声明满分。四段挣分：
 *
 * 1. 交互层（加分）——装机任务发出后，好的 agent 不闷头做，而是先停下来（park 在一个待
 *    输入请求上）把仓库里看不出的四件事问清楚，拿到方案再动手。`t.parked()` 判「停没停下来
 *    问」，四条 closeQA 各判一件「问得对不对、给的选择对不对」（判据构造见
 *    ./clarify-criteria.ts）。随后替用户挑第一档「简单接入」，用 `t.respond` 驱动下一轮把活
 *    干完——后面的取证才有东西可验。
 * 2. 装成没装成（gate）——niceeval 装没装成、装的东西能不能跑。这几条是 gate：红了 verdict
 *    直接 failed，后面「写得好不好」「读没读对文档」都失去讨论前提。gate 不给分，但挂了就把
 *    整题按判定面判负（`.points` 与 severity 正交）。
 * 3. 过程侧（加分）——agent 自己有没有真的敲命令把它跑起来（而不是手抄托管指引、只写文件
 *    不执行）。每条检查点值 1 分。
 * 4. 最佳实践（加分）——装的姿势对不对：装成 devDependency、托管指引是 init 写的托管区块、
 *    非 JS 宿主另建独立 eval 工作区且是 ESM。判据逐条来自 INIT.md 的 Step 1 / Step 2，
 *    跟第 2 段的区别是「能不能用」与「以后好不好维护」之别，所以是加分不是 gate。
 *
 * 写法约定：判定一律用官方断言词汇（parked / calledTool / matchers / judge），不发明领域
 * API；取证一律「一条命令或一个文件」——探针只取证不判定，判定是紧跟着的一条 t.check 配
 * matcher，没有解析层、没有扫落盘的循环。
 *
 * 一个考试项目一个评估函数，函数名就是考项名（评估什么就叫什么）：
 * - evalInteraction —— 评估交互：动手前停下来问对没问对 + 替用户给罐头答复续轮；
 * - evalInstall —— 评估安装：装成没装成（gate）+ 过程侧（加分）+ 最佳实践（加分）的落地取证。
 * 拆成两个考项的原因：评估交互的四条澄清判据（接口 / otel / flag / 三档接入等级）与「挑
 * 第一档」的罐头答复都假设被测系统是个要自写 adapter 的 AI 应用——对 sandbox 接入路径
 * （评 coding agent，用内置 agents，没有自写 adapter，tier 三档不成立）不适用，那条路径
 * 交互层各写各的，评估安装仍走同一份。
 *
 * 两者与 evalExperiment（见 ./eval-experiment.ts）被 install 下多条接入路径 eval 共用；
 * 不放顶层 lib/ 是因为它不服务 debug 这类非接入路径评估。locateInstallRoot 也住在这里——
 * 「装在了哪」天然是安装检查的一部分，evalExperiment / evalAdapter / fixture / agent-archive
 * 都从这里取用。
 */

import type { ScoreAssertionHandle, ScoreTestContext, TurnHandle } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { readCandidateManifest } from "../../../lib/candidate.ts";
import { buildClarifyRubrics, type ClarifyFacts } from "./clarify-criteria.ts";

/**
 * `niceeval exp --dry --json` 的单文档形状（`docs/feature/experiments/cli.md#机器怎么读--json`）。
 * 不从 `niceeval` 包里取——包的公开面导出的是运行时事件流类型，这个形状是候选 CLI 输出的
 * 纯文本协议，候选版本与 harness 自身的 devDependency 版本无关，这里按契约本地声明。
 */
export interface ExpPlanRow {
  experimentId: string;
  evalId: string;
  /** 命中缓存指纹，本次不会派发新 attempt。 */
  reused: boolean;
}

export interface ExpPlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  /** matrix 行数 × attempts。 */
  total: number;
  evals: number;
  configs: number;
  /** 当前候选的每格重复次数。 */
  attempts?: number;
  /** niceeval <= 0.11.0 的旧字段；用于对照组协议兼容。 */
  runs?: number;
  /** matrix 逐行 reused 之和。 */
  reused: number;
  matrix: ExpPlanRow[];
}

/**
 * 解析 `niceeval exp --dry --json` 的 stdout。正常情况下整段 stdout 就是一个 JSON 文档；
 * `npx --no-install` 理论上不产生额外噪音，但为防御偶发的 npm 输出混入 stdout（stderr 已用
 * `2>/dev/null` 分流），兜底按 `format` marker 定位最后一个能闭合的 `{...}` 块再解析。
 * 两条路径都失败时返回 null，交给调用方按 gate/软分各自的语义处理。
 */
export function parseExpPlanDocument(stdout: string): ExpPlanDocument | null {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as ExpPlanDocument;
  } catch {
    // 整段不是纯 JSON，继续走 marker 兜底
  }
  const marker = '"format":"niceeval.exp-plan"';
  const markerIdx = trimmed.lastIndexOf(marker);
  if (markerIdx === -1) return null;
  const start = trimmed.lastIndexOf("{", markerIdx);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1)) as ExpPlanDocument;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 装机落点那份 package.json 里，最佳实践层要看的三件事。 */
export interface InstallManifest {
  /** ESM 形态标记：INIT.md 要求新建的 eval 工作区带 `"type": "module"` */
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** 解析装机落点的 package.json；没有或解析不了返回 null（判据按「没挣到」处理，不抛）。 */
export function parsePackageJson(stdout: string): InstallManifest | null {
  try {
    return JSON.parse(stdout.trim()) as InstallManifest;
  } catch {
    return null;
  }
}

/**
 * 找 agent 把 niceeval 装在了哪；没装返回 null。
 *
 * 不假设一定在 workdir 根：python-service 这类非 JS 宿主的正确做法就是
 * 就地新建一个子目录来放 package.json 与三件套，装在子目录里不算错。
 */
export async function locateInstallRoot(sandbox: ScoreTestContext["sandbox"]): Promise<string | null> {
  const hit = (
    await sandbox.runShell(
      `find . -name niceeval.config.ts -not -path '*/node_modules/*' -maxdepth 3 | head -1`,
    )
  ).stdout.trim();
  if (!hit) return null;
  // ./sub/niceeval.config.ts -> sub ; ./niceeval.config.ts -> .
  return hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "") || ".";
}

/**
 * 评估交互（加分，不 gate）：动手前停下来问对没问对，判完替用户给罐头答复驱动续轮。
 *
 * 前置：装机任务已由 eval 发出（`t.send(...)`），此刻 agent 应已 park 在澄清请求上。
 *
 * `clarify` 必须由调用方按项目传入项目专属事实（接口形状 / otel 机制 / 可做变体的参数）：
 * 判据的**机制**各路径通用，住在 ./clarify-criteria.ts；判据里的**事实**逐项目不同，
 * 一份通用判据会把项目专属事实写死成假设。这里只负责把两者拼起来并按点计分。
 */
export async function evalInteraction(
  t: ScoreTestContext,
  opts: { clarify: ClarifyFacts; turn: TurnHandle<ScoreAssertionHandle> },
): Promise<void> {
  // ── 交互层（加分，不 gate）：动手前先停下来把仓库里看不出的四件事问清楚 ──────────
  // 判的是第一轮回复，所以要在 respond 续轮之前取——`t.reply` 是「最近一轮的助手回复」，
  // respond 之后它就变成下一轮的了。四条判据共用这一份快照。
  const clarifyReply = t.reply;
  await t.group("评估交互", async () => {
    // 真的停下来问了（park 在待输入请求上），而不是直接开做。
    // 交互层按文件头是「加分、不 gate」：得分点不参与判定，没停下来问只是少挣这些分，不判负。
    t.parked().points(1);
    // 问的内容与给的选择是否对：接口 / otel / flag（多 prompt）/ 三档接入等级，一条判据只判
    // 一个点、各挣 1 分。不合成一条 points(4)——closedQA 是二值打分器，四要件 AND 进一条会让
    // 「问了接口漏了 otel」和「什么都没问」拿一样的 0 分。事实由调用方按项目传入（见函数头注）。
    for (const r of buildClarifyRubrics(opts.clarify)) {
      t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, { on: clarifyReply }).points(1);
    }
  });

  // 替用户回答：挑第一档「简单接入」。respond 就是同一 session 的下一轮——agent 拿到方案后把
  // 活干完，后面的事后取证才有东西可验。三档里第一档最省，也不引入 otel / flag 的额外判定面。
  //
  // 但「停下来问」本身就是被测行为、不是前提：五条路径的任务描述都不再声明「没人可确认」
  // （INIT.md 只在任务明确说没人可确认时才允许 agent 自行决定，那句话在场会把这一整层变成
  // 「守文档就扣分」的死分），所以该问就该问——但 agent 可能不 park：要么一轮把活做完，
  // 要么把澄清问题写进回复文本就结束本轮（canary.6 实跑里 codex 两条路径都是后者——判交互
  // 的四条 judge 全给了 Y，turn 却是 completed）。这时没有待处理的 input.requested，无条件
  // respond 会抛「There is no pending input.requested」把整题打成 errored。所以真 park 了走
  // respond；没 park 就用同 session 的下一条消息把答复递过去，让 agent 拿到方案继续干活——
  // parked 那 1 分它没挣到已如实记，但后面的 gate / 产出 / 路由取证不能因此全部断粮。
  // 罐头答复要接得住 agent 实际会问的问题：canary.6 实跑里两条路径都问了「端点确认？
  // 被测服务谁起？judge 用什么 key？」，只答档位会让下一轮再停一次。最后一句关掉
  // 「继续等确认」的口子——真用户不在场，这条评估只给一次答复机会。
  const PICK_TIER_1 =
    "简单接入——写两个实验、先不接 otel，也先不做 flag。" +
    "接口就用你探到的那个；被测服务需要的话你自己起；judge 按文档处理，没有可用 key 就降级。" +
    "其余你自行决定，不用再等我确认。";
  if (opts.turn.status === "waiting") {
    await t.respond(PICK_TIER_1);
  } else {
    await t.send(PICK_TIER_1);
  }
}

/**
 * 评估安装：agent 干完后回看「装成没装成（gate）+ 过程侧（加分）+ 最佳实践（加分）」的落地取证。
 *
 * 前置：agent 已拿到方案并干完活（通常紧跟 evalInteraction 之后调；本函数只取证，
 * 不再驱动任何轮次）。
 *
 * `standaloneWorkspace` 声明「这条路径的宿主不是 JS 项目」：INIT.md 对这种宿主要求另建一个
 * 独立子目录放自己的 package.json（并给它 `"type": "module"`），不许装进宿主已有的包。
 * 五条 AI 应用路径（Python 宿主）传 true；sandbox 路径的宿主 Express 自己就是个 JS 包，
 * 装在根目录才是对的，不传——那两条判据对它无事实可验，不发空对空的分。
 */
export async function evalInstall(
  t: ScoreTestContext,
  opts: { version: string; standaloneWorkspace?: boolean },
): Promise<void> {
  const sandbox = t.sandbox;
  const candidate = readCandidateManifest(opts.version);

  const root = await locateInstallRoot(sandbox);
  const at = root ?? ".";

  const version = (
    await sandbox.runShell(
      `node -p "require('./node_modules/niceeval/package.json').version" 2>/dev/null || true`,
      { cwd: at },
    )
  ).stdout.trim();
  const managed = (
    await sandbox.runShell(`grep -l "node_modules/niceeval" AGENTS.md CLAUDE.md 2>/dev/null | head -1`, {
      cwd: at,
    })
  ).stdout.trim();
  // 用 agent 自己装的那个 CLI 来发现 eval / 规划实验——同时验证了「装的东西是能跑的」。
  // --dry --json 只解析 experiments/ 并输出单个 ExpPlanDocument，matrix 里一行对应一格能
  // 加载成功的配置；配置文件存在但加载报错时 dry-run 非零退出、matrix 清零，数 .ts 文件骗不
  // 了它。stderr 分流到 /dev/null，只留 stdout 上纯净的 JSON 文档（解析兜底见
  // parseExpPlanDocument）。
  const list = await sandbox.runShell(`npx --no-install niceeval list 2>&1`, { cwd: at });
  const dry = await sandbox.runShell(`npx --no-install niceeval exp --dry --json 2>/dev/null`, { cwd: at });
  const dryPlan = parseExpPlanDocument(dry.stdout);
  const hasTsconfig = await sandbox.pathExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const tsc = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

  // 最佳实践层的两个探针（判据见下面的 t.group）：装机落点那份 package.json，以及托管指引
  // 里有没有 init 的托管区块标记。都是「一个文件」，解析放在断言体外、判定紧跟 t.check。
  const pkg = parsePackageJson((await sandbox.runShell(`cat package.json 2>/dev/null`, { cwd: at })).stdout);
  const managedBlock = (
    await sandbox.runShell(`grep -l 'BEGIN:niceeval-agent-rules' AGENTS.md CLAUDE.md 2>/dev/null | head -1`, {
      cwd: at,
    })
  ).stdout.trim();

  await t.group("评估安装", async () => {
    // 装成没装成是后面一切的前提：这几条是 gate（不给分），红了 verdict 直接 failed。
    t.check(root !== null, isTrue("niceeval.config.ts 存在"));
    t.check(
      version,
      satisfies(
        (v) => v === candidate.version,
        `依赖解析到候选包 niceeval@${candidate.version}（实际：${version || "未安装"}）`,
      ),
    );
    t.check(managed.length > 0, isTrue("AGENTS.md / CLAUDE.md 里有托管指引区块"));
    t.check(list, commandSucceeded());
    t.check(
      list.stdout,
      satisfies(
        (s) =>
          (s as string).split("\n").some((l) => /\S/.test(l) && !/^(NAME|ID|—|-{3,})/.test(l.trim())),
        "niceeval 能发现 agent 写出的 eval",
      ),
    );
    t.check(
      dryPlan,
      // satisfies() 的 predicate 参数类型固定是 unknown（见 niceeval/expect），这里收窄回
      // ExpPlanDocument | null。
      satisfies((v) => {
        const p = v as ExpPlanDocument | null;
        return p !== null && p.matrix.length > 0;
      }, "exp --dry 能规划出至少一个 experiment"),
    );
    // 非 TS 宿主可以没有 tsconfig，这时不判——有 tsconfig 才要求 agent 自己的代码干净
    if (tsc) {
      t.check(
        tsc.stdout,
        satisfies(
          (s) => !/^(?!.*node_modules).*\(\d+,\d+\): error TS\d+:/m.test(s as string),
          "agent 写的代码 typecheck 干净",
        ),
      );
    }

    // 过程侧（加分，每条 1 分）：agent 该敲的命令敲没敲。跟上面几条的区别：上面是事后取证验
    // 产物、是 gate；这里回看 agent 自己的事件流、是加分——挣到才说明「是 agent 自己走完流程
    // 做对的」，没挣到也不连坐 gate。
    // "shell" 是 canonical 工具名（codex 的 command_execution、claude-code 的 Bash 都归一到它），
    // input.command 挂正则只对上 shell 调用的命令串——写进文件的文字不会被 Write 类调用误计；
    // 命中的调用会作为证据带进报告。
    // `(?:@\S+)?\s+(?:--\s+)?`：CLI 的合法调用形态不止 `npx niceeval <cmd>`——canary.7 实跑里
    // codex 全程用 `npm exec niceeval -- exp baseline`（`--` 分隔符卡在包名与子命令之间），
    // `npx niceeval@<version> <cmd>` 也常见。旧正则 `niceeval\s+exp` 对不上这两种，把真跑过的
    // 分误杀成 0（2026-07-24 canary.7 取证）。
    t.calledTool("shell", { input: { command: /\bniceeval(?:@\S+)?\s+(?:--\s+)?init\b/ } }).points(1); // 托管指引该由 CLI 写入，不是手抄
    // (?![\s\S]*--dry|[\s\S]*--help)：同一条命令里带 --dry / --help 的不算真跑。不要求带 --json
    // ——CLI 只有两种形态（人读文本 / --json），非 TTY 下人读文本本就自动降级为只追加流，
    // agent 直接跑默认形态完全合理，逼它加 --json 才算数会误伤。
    t.calledTool("shell", { input: { command: /\bniceeval(?:@\S+)?\s+(?:--\s+)?exp\b(?![\s\S]*--dry|[\s\S]*--help)/ } }).points(1);
    t.calledTool("shell", { input: { command: /\bniceeval(?:@\S+)?\s+(?:--\s+)?show\b/ } }).points(1);
  });

  // ── 最佳实践（纯加分，每条 1 分）：装成了之后，装的姿势对不对。 ───────────────────
  // 判据逐条来自 INIT.md 的 Step 1 / Step 2（「装哪、装成什么依赖、托管指引谁写」），
  // 与上面的 gate 是两回事：gate 判「能不能用」，这里判「以后还好不好维护」。
  // 全部 .points(1) 不 gate——姿势不讲究不影响这次跑通。
  //
  // 注意这几条是**新版本才教得到的分**：0.9.x 那代的 INIT.md 还没有「非 JS 宿主另建工作区 +
  // type: module + 装成 devDependency」这几句（实测 tag v0.9.1 的 INIT.md 里搜不到）。
  // 以后要把老候选加回对比组，它在这里读低分是如实读数，不是判据写错了。
  await t.group("评估安装最佳实践", async () => {
    // niceeval 是开发期工具，进 devDependencies；混进 dependencies 会被被测系统的生产
    // 安装一起拉下去。INIT.md 的安装命令本身就是 `add -D niceeval`。
    t.check(
      pkg,
      satisfies((v) => {
        const m = v as InstallManifest | null;
        return !!m?.devDependencies?.niceeval && !m?.dependencies?.niceeval;
      }, "niceeval 装在 devDependencies 里（不是 dependencies）"),
    ).points(1);

    // 托管指引由 `niceeval init` 写入：带 BEGIN/END 标记的托管区块，升级后重跑 init
    // 就能刷新。手抄一段同样的文字也能过上面那条 gate（它只 grep 关键字），但升级后不会更新。
    t.check(
      managedBlock.length > 0,
      isTrue(`托管指引是 init 写入的托管区块（有 BEGIN:niceeval-agent-rules 标记，实际：${managedBlock || "无"}）`),
    ).points(1);

    if (opts.standaloneWorkspace) {
      // 宿主不是 JS 项目：INIT.md 要求新建一个独立子目录装，不要装进宿主里已有的包——
      // 那些 package.json 与 lockfile 属于被测系统，混进去会连累它的工具链，也会把宿主
      // 自己的类型错误拉进 agent 的 typecheck。
      t.check(
        root !== null && root !== ".",
        isTrue(`eval 工作区是新建的独立子目录（实际装在：${root ?? "未安装"}）`),
      ).points(1);
      // 新建的 package.json 要 `"type": "module"`：`npm init -y` 默认 CommonJS，
      // 那种形态下 config / eval 文件用不了顶层 await。
      t.check(
        pkg,
        satisfies((v) => (v as InstallManifest | null)?.type === "module", 'eval 工作区的 package.json 是 ESM（"type": "module"）'),
      ).points(1);
    }
  });
}
