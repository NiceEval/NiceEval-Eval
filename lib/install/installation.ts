/**
 * 安装落点检查：gate 验证候选包、配置、托管指引、发现和 dry plan；另外计分实际执行过程及
 * 安装最佳实践。对话澄清在 `interaction.ts`，其它检查阶段各自在同名模块。
 */

import type { ScoreTestContext } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { readCandidateManifest } from "../candidate.ts";

/**
 * Codex 的 command_execution 事件只提供 shell source，command projection 因而按协议标成
 * opaque。过程加分只需要三个布尔事实；先归约命令文本可避免 calledTool 为上百个候选持久化
 * 一棵数 MiB 的逐候选诊断树。
 */
function shellCommands(t: ScoreTestContext): string[] {
  return t.events.flatMap((event) => {
    if (
      event.type !== "operation.started" ||
      event.operation.kind !== "tool" ||
      event.operation.tool !== "shell"
    ) {
      return [];
    }
    const input = event.operation.input;
    if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
    const command = input.command;
    return typeof command === "string" ? [command] : [];
  });
}

function ranNiceeval(commands: readonly string[], subcommand: "init" | "exp" | "show"): boolean {
  const invocation = new RegExp(`\\bniceeval(?:@\\S+)?\\s+(?:--\\s+)?${subcommand}\\b`);
  return commands.some((command) =>
    invocation.test(command) &&
    (subcommand !== "exp" || !/--dry\b|--help\b/.test(command)),
  );
}

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
 * 评估安装：agent 干完后回看「装成没装成（gate）+ 过程侧（加分）+ 最佳实践（加分）」的落地取证。
 *
 * 前置：agent 已拿到方案并干完活（通常紧跟 scoreIntegrationConversation 之后调；本函数只取证，
 * 不再驱动任何轮次）。
 *
 * `standaloneWorkspace` 声明「这条路径的宿主不是 JS 项目」：INIT.md 对这种宿主要求另建一个
 * 独立子目录放自己的 package.json（并给它 `"type": "module"`），不许装进宿主已有的包。
 * 五条 AI 应用路径（Python 宿主）传 true；sandbox 路径的宿主 Express 自己就是个 JS 包，
 * 装在根目录才是对的，不传——那两条判据对它无事实可验，不发空对空的分。
 */
export async function checkInstallation(
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
    t.check(root !== null, isTrue("niceeval.config.ts 存在")).gate();
    t.check(
      version,
      satisfies(`依赖解析到候选包 niceeval@${candidate.version}（实际：${version || "未安装"}）`, (v) => v === candidate.version),
    ).gate();
    t.check(managed.length > 0, isTrue("AGENTS.md / CLAUDE.md 里有托管指引区块")).gate();
    t.check(list, commandSucceeded()).gate();
    t.check(
      list.stdout,
      satisfies<string>(
        "niceeval 能发现 agent 写出的 eval",
        (s) => s.split("\n").some((l) => /\S/.test(l) && !/^(NAME|ID|—|-{3,})/.test(l.trim())),
      ),
    ).gate();
    t.check(
      dryPlan,
      satisfies("exp --dry 能规划出至少一个 experiment", (v) => {
        const p = v as ExpPlanDocument | null;
        return p !== null && p.matrix.length > 0;
      }),
    ).gate();
    // 非 TS 宿主可以没有 tsconfig，这时不判——有 tsconfig 才要求 agent 自己的代码干净
    if (tsc) {
      t.check(
        tsc.stdout,
        satisfies<string>("agent 写的代码 typecheck 干净", (s) => !/^(?!.*node_modules).*\(\d+,\d+\): error TS\d+:/m.test(s)),
      ).gate();
    }

    // 过程侧（加分，每条 1 分）：agent 该敲的命令敲没敲。跟上面几条的区别：上面是事后取证验
    // 产物、是 gate；这里回看 agent 自己的事件流、是加分——挣到才说明「是 agent 自己走完流程
    // 做对的」，没挣到也不连坐 gate。
    // 这里先把标准事件里的 shell command 归约成布尔事实，再登记紧凑断言。直接 calledTool(or(...))
    // 会把每个 shell occurrence 的完整匹配诊断持久化；安装 agent 常有上百次调用，三条过程分就能
    // 撑破 assertions 文档的 4 MiB 上限。我们仍只读取真实 operation.started，不扫回复或文件内容。
    // `(?:@\S+)?\s+(?:--\s+)?`：CLI 的合法调用形态不止 `npx niceeval <cmd>`——canary.7 实跑里
    // codex 全程用 `npm exec niceeval -- exp baseline`（`--` 分隔符卡在包名与子命令之间），
    // `npx niceeval@<version> <cmd>` 也常见。旧正则 `niceeval\s+exp` 对不上这两种，把真跑过的
    // 分误杀成 0（2026-07-24 canary.7 取证）。
    const commands = shellCommands(t);
    t.check(ranNiceeval(commands, "init"), isTrue("运行过 niceeval init"))
      .score(1).label("运行 niceeval init"); // 托管指引该由 CLI 写入，不是手抄
    // (?![\s\S]*--dry|[\s\S]*--help)：同一条命令里带 --dry / --help 的不算真跑。不要求带 --json
    // ——CLI 只有两种形态（人读文本 / --json），非 TTY 下人读文本本就自动降级为只追加流，
    // agent 直接跑默认形态完全合理，逼它加 --json 才算数会误伤。
    t.check(ranNiceeval(commands, "exp"), isTrue("实际运行过非 dry/help 的 niceeval exp"))
      .score(1).label("实际运行 niceeval exp");
    t.check(ranNiceeval(commands, "show"), isTrue("运行过 niceeval show"))
      .score(1).label("运行 niceeval show");
  });

  // ── 最佳实践（纯加分，每条 1 分）：装成了之后，装的姿势对不对。 ───────────────────
  // 判据逐条来自 INIT.md 的 Step 1 / Step 2（「装哪、装成什么依赖、托管指引谁写」），
  // 与上面的 gate 是两回事：gate 判「能不能用」，这里判「以后还好不好维护」。
  // 全部 `.score(1)` 不 gate——姿势不讲究不影响这次跑通。
  //
  // 注意这几条是**新版本才教得到的分**：0.9.x 那代的 INIT.md 还没有「非 JS 宿主另建工作区 +
  // type: module + 装成 devDependency」这几句（实测 tag v0.9.1 的 INIT.md 里搜不到）。
  // 以后要把老候选加回对比组，它在这里读低分是如实读数，不是判据写错了。
  await t.group("评估安装最佳实践", async () => {
    // niceeval 是开发期工具，进 devDependencies；混进 dependencies 会被被测系统的生产
    // 安装一起拉下去。INIT.md 的安装命令本身就是 `add -D niceeval`。
    t.check(
      pkg,
      satisfies("niceeval 装在 devDependencies 里（不是 dependencies）", (v) => {
        const m = v as InstallManifest | null;
        return !!m?.devDependencies?.niceeval && !m?.dependencies?.niceeval;
      }),
    ).score(1).label("niceeval 位于 devDependencies");

    // 托管指引由 `niceeval init` 写入：带 BEGIN/END 标记的托管区块，升级后重跑 init
    // 就能刷新。手抄一段同样的文字也能过上面那条 gate（它只 grep 关键字），但升级后不会更新。
    t.check(
      managedBlock.length > 0,
      isTrue(`托管指引是 init 写入的托管区块（有 BEGIN:niceeval-agent-rules 标记，实际：${managedBlock || "无"}）`),
    ).score(1).label("init 托管指引区块");

    if (opts.standaloneWorkspace) {
      // 宿主不是 JS 项目：INIT.md 要求新建一个独立子目录装，不要装进宿主里已有的包——
      // 那些 package.json 与 lockfile 属于被测系统，混进去会连累它的工具链，也会把宿主
      // 自己的类型错误拉进 agent 的 typecheck。
      t.check(
        root !== null && root !== ".",
        isTrue(`eval 工作区是新建的独立子目录（实际装在：${root ?? "未安装"}）`),
      ).score(1).label("独立 eval 工作区");
      // 新建的 package.json 要 `"type": "module"`：`npm init -y` 默认 CommonJS，
      // 那种形态下 config / eval 文件用不了顶层 await。
      t.check(
        pkg,
        satisfies('eval 工作区的 package.json 是 ESM（"type": "module"）', (v) => (v as InstallManifest | null)?.type === "module"),
      ).score(1).label("eval 工作区 ESM");
    }
  });
}
