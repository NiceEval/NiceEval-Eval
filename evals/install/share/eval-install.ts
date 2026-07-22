/**
 * 评估安装（计分制 / 加分式）：一条题内叠加挣分，分从 0 往上累加、不声明满分。三段挣分：
 *
 * 1. 交互层（加分）——装机任务发出后，好的 agent 不闷头做，而是先停下来（park 在一个待
 *    输入请求上）把仓库里看不出的三件事问清楚，拿到方案再动手。`t.parked()` 判「停没停下来
 *    问」，closeQA 判「问得对不对、给的选择对不对」。随后替用户挑第一档「简单接入」，用
 *    `t.respond` 驱动下一轮把活干完——后面的取证才有东西可验。
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
 * evalInstall 与 evalExperiment（见 ./eval-experiment.ts）被 install 与 undo 两组
 * 接入路径 eval 共用（undo 未来会并入 install，届时就是纯 install 内部件）；不放顶层 lib/
 * 是因为它不服务 debug 这类非接入路径评估。locateInstallRoot 也住在这里——「装在了哪」
 * 天然是安装检查的一部分，evalExperiment / evalAdapter / fixture / agent-archive
 * 都从这里取用。
 */

import type { TestContext, TurnHandle } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { readCandidateManifest } from "../../../lib/candidate.ts";

/**
 * 找 agent 把 niceeval 装在了哪；没装返回 null。
 *
 * 不假设一定在 workdir 根：python-service 这类非 JS 宿主的正确做法就是
 * 就地新建一个子目录来放 package.json 与三件套，装在子目录里不算错。
 */
export async function locateInstallRoot(sandbox: TestContext["sandbox"]): Promise<string | null> {
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
 * `clarifyCriteria` 必须由调用方按项目传入：closeQA 判「agent 动手前停下来问对没问对」，
 * 而「问什么才算对」是逐项目的——被测系统的接口形状（DB-GPT 是 OpenAI 兼容 HTTP，
 * gpt-researcher 是自研 WebSocket 帧）和它自带的 otel 机制各不一样，一份通用判据会把
 * 项目专属事实写死成假设。判据本体因此下沉到各 eval 文件，这里只保留「停下来问 + 按连续
 * 分挣分」这套机制。
 */
export async function evalInstall(
  t: TestContext,
  opts: { version: string; clarifyCriteria: string; turn: TurnHandle },
): Promise<void> {
  const sandbox = t.sandbox;
  const candidate = readCandidateManifest(opts.version);

  // ── 交互层（加分，不 gate）：动手前先停下来把仓库里看不出的三件事问清楚 ──────────
  await t.group("评估交互", async () => {
    // 真的停下来问了（park 在待输入请求上），而不是直接开做。
    // .soft()：交互层按文件头是「加分、不 gate」，而 parked 断言默认 severity 是 gate、
    // .points() 与 severity 正交并不降级——漏了 .soft() 就会让「agent 没停下来问、直接
    // 一轮做完」（对「没人可确认」的任务是合理路径）一票判负，与本层只加分的设计相悖。
    t.parked().points(1).soft();
    // 问的内容与给的选择是否对：接口对不对 / 有没有 otel / 有没有 flag（多 prompt），外加三档接入方案。
    // 判据按项目传入（见函数头注），因为「问对」的内容随宿主接口与 otel 机制而变。
    t.judge.autoevals.closedQA(opts.clarifyCriteria, { on: t.reply }).points(3);
  });

  // 替用户回答：挑第一档「简单接入」。respond 就是同一 session 的下一轮——agent 拿到方案后把
  // 活干完，后面的事后取证才有东西可验。三档里第一档最省，也不引入 otel / flag 的额外判定面。
  //
  // 但「停下来问」本身是被测行为、不是前提：任务里明说「Nobody is available to confirm
  // decisions with」，agent 完全可能（合理地）不问、一轮把活做完。这时 turn 是 completed/
  // failed 而非 waiting，没有待处理的 input.requested——若仍无条件 respond，会抛
  // 「There is no pending input.requested」把整题打成 errored，连后面的 gate / 路由 /
  // adapter 都白评。所以只在真 park 了才续轮；没 park 就直接进入事后取证，agent 一轮里
  // 已经产出的三件套照样按 gate / 加分评（park 那 1 分它没挣到，t.parked() 已如实记）。
  if (opts.turn.status === "waiting") {
    await t.respond("简单接入——写两个实验、先不接 otel，也先不做 flag。");
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
  // --dry 只解析 experiments/ 并规划矩阵，一行 plan-row 对应一格能加载成功的配置；
  // 配置文件存在但加载报错时 dry-run 非零退出、规划数清零，数 .ts 文件骗不了它。
  const list = await sandbox.runShell(`npx --no-install niceeval list 2>&1`, { cwd: at });
  const dry = await sandbox.runShell(`npx --no-install niceeval exp --dry --output ci 2>&1`, { cwd: at });
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
      dry.stdout,
      satisfies((s) => /^niceeval: plan-row /m.test(s as string), "exp --dry 能规划出至少一个 experiment"),
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
    // .soft()：本段注释明说「没挣到也不连坐 gate」，但 calledTool 默认 severity 是 gate、
    // .points() 不降级——只链 .points 会让「没敲这条命令」判负，与「加分、不连坐」相悖。
    t.calledTool("shell", { input: { command: /\bniceeval\s+init\b/ } }).points(1).soft(); // 托管指引该由 CLI 写入，不是手抄
    // (?![\s\S]*--dry)：同一条命令里带 --dry 的不算真跑。不强制 --output agent——
    // 非 TTY 下 auto profile 本来就落到 agent，逼显式 flag 会误伤
    t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b(?![\s\S]*--dry)/ } }).points(1).soft();
    t.calledTool("shell", { input: { command: /\bniceeval\s+show\b/ } }).points(1).soft();
  });
}
