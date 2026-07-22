/**
 * 评估安装：niceeval 装没装成（gate）+ agent 有没有真的敲命令把它跑起来（软分）。
 *
 * gate 的那部分红了，说明 agent 没把 niceeval 装成一个能用的东西，后面「写得好不好」
 * 「读没读对文档」都失去讨论前提。gate 部分是唯一影响 verdict 硬失败的判定——这组红了，
 * 后面所有判定都失去前提。
 *
 * 写法约定：判定一律用官方断言词汇（calledTool / matchers / judge），不发明领域 API；
 * 取证一律「一条命令或一个文件」——探针只取证不判定，判定是紧跟着的一条 t.check 配
 * matcher，没有解析层、没有扫落盘的循环。
 *
 * evalInstall 与 evalExperiment（见 ./eval-experiment.ts）被 install 与 undo 两组
 * 接入路径 eval 共用（undo 未来会并入 install，届时就是纯 install 内部件）；不放顶层 lib/
 * 是因为它不服务 debug 这类非接入路径评估。locateInstallRoot 也住在这里——「装在了哪」
 * 天然是安装检查的一部分，evalExperiment / evalAdapter / fixture / agent-archive
 * 都从这里取用。
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
 * 评估安装：niceeval 装没装成（gate）+ agent 有没有真的敲命令把它跑起来（软分）。
 * gate 部分是唯一影响 verdict 硬失败的判定——这组红了，后面所有判定都失去前提。
 */
export async function evalInstall(t: TestContext, opts: { version: string }): Promise<void> {
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
  const hasTsconfig = await sandbox.fileExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const tsc = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

  await t.group("评估安装", async () => {
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

    // 过程侧：agent 该敲的命令敲没敲。跟上面几条的区别：上面是事后取证验产物，这里回看
    // agent 自己的事件流——两者都绿才说明「东西是对的」且「是 agent 自己走完流程做对的」。
    // "shell" 是 canonical 工具名（codex 的 command_execution、claude-code 的 Bash 都归一到它），
    // input.command 挂正则只对上 shell 调用的命令串——写进文件的文字不会被 Write 类调用误计；
    // 命中的调用会作为证据带进报告。
    t.calledTool("shell").atLeast(1); // 真的执行过命令，而不是只写文件
    t.calledTool("shell", { input: { command: /\bniceeval\s+init\b/ } }).atLeast(1); // 托管指引该由 CLI 写入，不是手抄
    // (?![\s\S]*--dry)：同一条命令里带 --dry 的不算真跑。不强制 --output agent——
    // 非 TTY 下 auto profile 本来就落到 agent，逼显式 flag 会误伤
    t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b(?![\s\S]*--dry)/ } }).atLeast(1);
    t.calledTool("shell", { input: { command: /\bniceeval\s+show\b/ } }).atLeast(1);
  });
}
