/**
 * 通用检查：与宿主无关、四条接入路径共用的判定，一次入口出两个 group。
 *
 * - 「安装链」（gate）——安装链到底通没通。全部是客观事实，不含任何品味判断：
 *   文件在不在、版本对不对、命令退不退 0。它是全部检查里唯一应该 gate 的一组：
 *   这组红了，说明 agent 没把 niceeval 装成一个能用的东西，后面「写得好不好」
 *   「读没读对文档」都失去了讨论前提。
 * - 「通用品味」（软分）——装对了之后写得讲不讲究：至少两个实验（一个 baseline
 *   加至少一个对比，只有一格什么也比不了）、每格 runs=1（接入期多 runs 只是烧
 *   时间）、没有为一两个实验先抽 shared.ts 共享抽象。品味红了东西还是能用的，
 *   所以不 gate。
 *
 * - 「执行正确性」（软分）——过程侧：agent 的事件流里有没有真的敲过该敲的命令
 *   （niceeval init / exp / show）。与「能动性」互补：能动性看结果侧（落盘产物证明
 *   跑成了），这里看过程侧（命令敲没敲）。命令敲了但能动性红 → 跑了没跑成；
 *   命令都没敲 → 压根没试。两侧一起才能把「没做」和「做了没成」分开归因。
 *
 * 通用检查还有第四块「能动性」（真跑过一次、真收到回应、show 能读出结果），在
 * lib/produce-quality.ts 的 assertAdapterRanLive——它要读内层真跑的落盘产物、文案
 * 需要被测系统名，所以住在那边，但概念上同属通用检查。
 *
 * 产出质量层（judge 怎么写）与路由层（期望哪几页）跟宿主强相关，各 eval 文件自己写。
 */

import type { TestContext } from "niceeval";
import { commandSucceeded, isTrue, satisfies } from "niceeval/expect";
import { readCandidateManifest } from "./candidate.ts";
// 幻想 API（尚不存在，typecheck 红是有意的）：workspace 里发现 niceeval 安装。规格见
// lib/produce-quality.ts 头注。
import { openProject } from "niceeval/project";

/** 数 tsc 输出里属于 agent 自己代码的错误行（`path(line,col): error TSxxxx:`） */
function countOwnTypeErrors(tscOutput: string): number {
  return tscOutput
    .split("\n")
    .filter((line) => /^\S+\(\d+,\d+\): error TS\d+:/.test(line))
    .filter((line) => !line.includes("node_modules")).length;
}

/** `exp --dry --output ci` 里一格能加载成功的实验配置 */
interface PlanRow {
  experiment: string;
  runs: number;
}

/**
 * 解析 dry-run 的 plan-row 行：`niceeval: plan-row experiment=<id> evals=<…> runs=<n>`。
 * 值含空格时 CLI 会用 JSON 引号包裹（escapeFieldValue），experiment 两种形态都兼容；
 * runs 是数字、永远裸着，且固定是行尾最后一个字段。
 */
function parsePlanRows(stdout: string): PlanRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("niceeval: plan-row"))
    .map((line) => ({
      experiment:
        /\bexperiment="([^"]+)"/.exec(line)?.[1] ?? /\bexperiment=(\S+)/.exec(line)?.[1] ?? "",
      runs: Number(/\bruns=(\d+)\s*$/.exec(line)?.[1] ?? NaN),
    }));
}

/**
 * 通用检查入口：安装链（gate）+ 通用品味（软分）。这两组断言跟宿主是谁无关，
 * 四条接入路径判的是同一件事——所以抽成一个函数共用。
 */
export async function runGenericChecks(
  t: TestContext,
  opts: { version: string },
): Promise<void> {
  const sandbox = t.sandbox;
  const project = await openProject(sandbox);
  const at = project?.root ?? ".";

  const versionProbe = await sandbox.runShell(
    `node -p "require('./node_modules/niceeval/package.json').version" 2>/dev/null || true`,
    { cwd: at },
  );
  const installedVersion = versionProbe.stdout.trim() || null;
  const candidate = readCandidateManifest(opts.version);

  const managed = await sandbox.runShell(
    `grep -l "node_modules/niceeval" AGENTS.md CLAUDE.md 2>/dev/null | head -1`,
    { cwd: at },
  );

  // 用 agent 自己装的那个 CLI 来发现 eval——这一步同时验证了「装的东西是能跑的」
  const list = await sandbox.runShell(`npx --no-install niceeval list 2>&1`, { cwd: at });
  // list 的输出里每条 eval 一行；只数含 eval id 分隔符的行，避免把表头算进来
  const discoveredEvalCount = list.stdout
    .split("\n")
    .filter((line) => /\S/.test(line) && !/^(NAME|ID|—|-{3,})/.test(line.trim())).length;

  // --dry 不会真的起 agent turn，只解析 experiments/ 并规划矩阵；一行 plan-row
  // 对应一个能加载成功的配置，且自带 experiment id 与 runs——一个文件存在但加载时
  // 报错，dry-run 会直接非零退出、规划数清零，这才是「agent 写的 experiment 能不能跑」
  // 的真实信号，数 experiments/ 下有几个 .ts 文件骗不了它。品味组的「几格配置」
  // 「runs 是几」也全从这里读，不去 parse agent 写的 TS。
  const dryRun = await sandbox.runShell(`npx --no-install niceeval exp --dry --output ci 2>&1`, { cwd: at });
  const planRows = parsePlanRows(dryRun.stdout);
  const experimentIds = [...new Set(planRows.map((r) => r.experiment).filter(Boolean))];

  // 品味：有没有为一两个实验先抽 shared.ts 抽象。只在三件套目录里找，宿主自己的
  // 同名文件（如前端工程里的 shared.ts）不在这几个目录下，不会被误伤。
  const sharedHits = (
    await sandbox.runShell(
      `find experiments agents adapters -maxdepth 2 -iname 'shared*.ts' 2>/dev/null`,
      { cwd: at },
    )
  ).stdout
    .trim()
    .split("\n")
    .filter(Boolean);

  const hasTsconfig = await sandbox.fileExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const typecheck = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

  await t.group("安装链", async () => {
    t.check(project !== null, isTrue("niceeval.config.ts 存在").gate());
    t.check(
      installedVersion === candidate.version,
      isTrue(`依赖解析到候选包（实际：${installedVersion ?? "未安装"}）`).gate(),
    );
    t.check(managed.stdout.trim().length > 0, isTrue("AGENTS.md / CLAUDE.md 里有托管指引区块").gate());
    t.check(list, commandSucceeded());
    t.check(
      discoveredEvalCount,
      satisfies((n) => (n as number) >= 1, "niceeval 能发现 agent 写出的 eval").gate(),
    );
    t.check(
      planRows.length,
      satisfies((n) => (n as number) >= 1, "niceeval exp --dry 能规划出至少一个 experiment").gate(),
    );
    // 非 TS 宿主可以没有 tsconfig，这时不判失败——有 tsconfig 才要求它是干净的
    if (typecheck) {
      t.check(
        countOwnTypeErrors(typecheck.stdout),
        satisfies((n) => n === 0, "agent 写的代码 typecheck 干净").gate(),
      );
    }
  });

  await t.group("通用品味", async () => {
    // 一格实验什么也比不了：baseline 之外至少还要有一个对比格，报告才有「对照」可言。
    // 宿主接口完全不支持任何变体时允许退化，所以是软分不是 gate。
    t.check(
      experimentIds.length,
      satisfies(
        (n) => (n as number) >= 2,
        `至少两格实验配置——baseline 加至少一个对比（实际：${experimentIds.join(", ") || "无"}）`,
      ).atLeast(1),
    );
    // compare-models 是 INIT.md 明确要求的默认组织方式
    t.check(
      experimentIds.some((id) => /\bcompare-models\//.test(id)),
      isTrue("按 compare-models 实验组组织").atLeast(1),
    );
    // 接入期每格 runs=1：先跑通一次再谈统计，多 runs 只是烧时间和预算
    t.check(
      planRows.length > 0 && planRows.every((r) => r.runs === 1),
      isTrue(
        `每格实验 runs=1（实际：${planRows.map((r) => `${r.experiment}×${r.runs}`).join(", ") || "无"}）`,
      ).atLeast(1),
    );
    // 一两个实验不配抽象层：shared.ts 是文档里给「实验多了以后」的写法，起手就抽是过度设计
    t.check(
      sharedHits.length === 0,
      isTrue(`没有先抽 shared.ts 共享抽象（实际：${sharedHits.join(", ") || "无"}）`).atLeast(1),
    );
  });

  // 过程侧：agent 该敲的命令敲没敲。跟上面「安装链」的区别：安装链是 harness 事后
  // 自己去沙箱里跑命令验证产物，这里是回看 agent 自己的事件流——两者都绿才说明
  // 「东西是对的」且「是 agent 自己走完流程做对的」。
  //
  // 用官方 calledTool 断言，不自己抽命令串跑正则："shell" 是 canonical 工具名
  // （codex 的 command_execution、claude-code 的 Bash 都归一到它，换被测 agent 不用改），
  // input.command 挂正则只对上 shell 调用的命令串——agent 往文件里写一句含
  // `niceeval exp` 的文字不会被 Write 类调用误计；命中/未命中的调用还会作为证据
  // 带进报告。读没读对文档页是同一性质的过程断言，但期望页面跟宿主强相关，
  // 留在各 eval 的路由层。
  await t.group("执行正确性", async () => {
    // 真的执行过命令，而不是只写文件
    t.calledTool("shell").atLeast(1);
    // 托管指引该由 CLI 写入，不是手抄
    t.calledTool("shell", { input: { command: /\bniceeval\s+init\b/ } }).atLeast(1);
    // (?![\s\S]*--dry)：同一条命令里带 --dry 的不算真跑。不强制 --output agent——
    // 非 TTY 下 auto profile 本来就落到 agent，逼显式 flag 会误伤
    t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b(?![\s\S]*--dry)/ } }).atLeast(1);
    t.calledTool("shell", { input: { command: /\bniceeval\s+show\b/ } }).atLeast(1);
  });
}
