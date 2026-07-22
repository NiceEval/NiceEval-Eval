/**
 * 通用检查：与宿主无关、四条接入路径共用的判定，一次入口出三个 group。
 *
 * - 「安装链」（gate）——安装链到底通没通，全部客观事实。唯一 gate 的一组：这组红了，
 *   说明 agent 没把 niceeval 装成一个能用的东西，后面「写得好不好」「读没读对文档」
 *   都失去讨论前提。
 * - 「通用品味」（软分）——装对了之后写得讲不讲究：至少两格实验（baseline + 对比）、
 *   每格 runs=1、不为一两个实验先抽 shared.ts。品味红了东西还是能用的，不 gate。
 * - 「执行正确性」（软分）——过程侧：agent 的事件流里该敲的命令敲没敲。
 *
 * 第四块「能动性」在 checks-quality.ts 的 assertAdapterRanLive，概念上同属通用检查。
 *
 * 写法约定：判定一律用官方断言词汇（calledTool / matchers / judge），不发明领域 API；
 * 取证一律「一条命令或一个文件」——探针只取证不判定，判定是紧跟着的一条 t.check 配
 * matcher，没有解析层、没有扫落盘的循环。
 *
 * 目前 install 与 undo 两组接入路径 eval 共用这份检查（undo 未来会并入 install，届时
 * 就是纯 install 内部件，不用再挪）；不放顶层 lib/ 是因为它不服务 debug 这类非接入路径评估。
 */

import type { TestContext } from "niceeval";
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
 * 通用检查入口：安装链（gate）+ 通用品味（软分）+ 执行正确性（软分）。这些断言跟宿主
 * 是谁无关，四条接入路径判的是同一件事——所以抽成一个函数共用。
 */
export async function runGenericChecks(
  t: TestContext,
  opts: { version: string },
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
  // --dry 只解析 experiments/ 并规划矩阵，一行 plan-row 对应一格能加载成功的配置；
  // 配置文件存在但加载报错时 dry-run 非零退出、规划数清零，数 .ts 文件骗不了它。
  const list = await sandbox.runShell(`npx --no-install niceeval list 2>&1`, { cwd: at });
  const dry = await sandbox.runShell(`npx --no-install niceeval exp --dry --output ci 2>&1`, { cwd: at });
  const shared = (
    await sandbox.runShell(`find experiments agents adapters -maxdepth 2 -iname 'shared*.ts' 2>/dev/null`, {
      cwd: at,
    })
  ).stdout.trim();
  const hasTsconfig = await sandbox.fileExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const tsc = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

  await t.group("安装链", async () => {
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
  });

  await t.group("通用品味", async () => {
    // 一格实验什么也比不了：baseline 之外至少还要有一个对比格。宿主接口完全不支持
    // 任何变体时允许退化，所以是软分不 gate。
    t.check(
      dry.stdout,
      satisfies(
        (s) => ((s as string).match(/^niceeval: plan-row /gm)?.length ?? 0) >= 2,
        "至少两格实验配置——baseline 加至少一个对比",
      ).atLeast(1),
    );
    // compare-models 是 INIT.md 明确要求的默认组织方式
    t.check(
      dry.stdout,
      satisfies(
        (s) => /experiment="?[^"\s]*\bcompare-models\//.test(s as string),
        "按 compare-models 实验组组织",
      ).atLeast(1),
    );
    // 接入期每格 runs=1：先跑通一次再谈统计，多 runs 只是烧时间和预算
    t.check(
      dry.stdout,
      satisfies((s) => !/\bruns=(?!1\b)\d+/.test(s as string), "每格实验 runs=1").atLeast(1),
    );
    // 一两个实验不配抽象层：shared.ts 是文档里给「实验多了以后」的写法，起手就抽是过度设计
    t.check(shared.length === 0, isTrue(`没有先抽 shared.ts 共享抽象（实际：${shared || "无"}）`).atLeast(1));
  });

  // 过程侧：agent 该敲的命令敲没敲。跟安装链的区别：安装链是事后取证验产物，这里回看
  // agent 自己的事件流——两者都绿才说明「东西是对的」且「是 agent 自己走完流程做对的」。
  // "shell" 是 canonical 工具名（codex 的 command_execution、claude-code 的 Bash 都归一到它），
  // input.command 挂正则只对上 shell 调用的命令串——写进文件的文字不会被 Write 类调用误计；
  // 命中的调用会作为证据带进报告。读没读对文档页是同一性质的过程断言，但期望页面跟宿主
  // 强相关，留在各 eval 的路由层。
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
