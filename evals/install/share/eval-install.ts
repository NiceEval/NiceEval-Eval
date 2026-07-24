/**
 * 评估安装（计分制 / 加分式）：一条题内叠加挣分，分从 0 往上累加、不声明满分。三段挣分：
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
 *
 * 写法约定：判定一律用官方断言词汇（parked / calledTool / matchers / judge），不发明领域
 * API；取证一律「一条命令或一个文件」——探针只取证不判定，判定是紧跟着的一条 t.check 配
 * matcher，没有解析层、没有扫落盘的循环。
 *
 * evalInstall 与 evalExperiment（见 ./eval-experiment.ts）被 install 下五条接入路径 eval
 * 共用；不放顶层 lib/
 * 是因为它不服务 debug 这类非接入路径评估。locateInstallRoot 也住在这里——「装在了哪」
 * 天然是安装检查的一部分，evalExperiment / evalAdapter / fixture / agent-archive
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
  /** matrix 行数 × runs。 */
  total: number;
  evals: number;
  configs: number;
  runs: number;
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
 * 评估安装（计分制）：交互层（加分）+ 装成没装成（gate）+ 过程侧（加分）。见文件头注。
 *
 * 前置：装机任务已由 eval 发出（`t.send(...)`），此刻 agent 应已 park 在澄清请求上。
 *
 * `clarify` 必须由调用方按项目传入项目专属事实（接口形状 / otel 机制 / 可做变体的参数）：
 * 判据的**机制**五条路径通用，住在 ./clarify-criteria.ts；判据里的**事实**逐项目不同，
 * 一份通用判据会把项目专属事实写死成假设。这里只负责把两者拼起来并按点计分。
 */
export async function evalInstall(
  t: ScoreTestContext,
  opts: { version: string; clarify: ClarifyFacts; turn: TurnHandle<ScoreAssertionHandle> },
): Promise<void> {
  const sandbox = t.sandbox;
  const candidate = readCandidateManifest(opts.version);

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
  const PICK_TIER_1 = "简单接入——写两个实验、先不接 otel，也先不做 flag。";
  if (opts.turn.status === "waiting") {
    await t.respond(PICK_TIER_1);
  } else {
    await t.send(PICK_TIER_1);
  }

  // ── 事后取证：agent 干完后再回看装成没装成 + 过程侧 ──────────────────────────────
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
  const hasTsconfig = await sandbox.fileExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const tsc = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

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
    t.calledTool("shell", { input: { command: /\bniceeval\s+init\b/ } }).points(1); // 托管指引该由 CLI 写入，不是手抄
    // (?![\s\S]*--dry)：同一条命令里带 --dry 的不算真跑。不要求带 --json——CLI 只有两种形态
    // （人读文本 / --json），非 TTY 下人读文本本就自动降级为只追加流，agent 直接跑默认形态
    // 完全合理，逼它加 --json 才算数会误伤。
    t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b(?![\s\S]*--dry)/ } }).points(1);
    t.calledTool("shell", { input: { command: /\bniceeval\s+show\b/ } }).points(1);
  });
}
