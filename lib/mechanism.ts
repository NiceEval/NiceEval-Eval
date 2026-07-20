/**
 * 检查 niceeval 是否安装好：安装链到底通没通。
 *
 * 全部是客观事实，不含任何品味判断——文件在不在、版本对不对、命令退不退 0。
 * 它是三层里唯一应该 gate 的一层：这层红了，说明 agent 没把 niceeval 装成一个
 * 能用的东西，后面「写得好不好」「读没读对文档」都失去了讨论前提。
 *
 * 跟宿主是谁无关，四条接入路径判的是同一件事，所以直接抽成共用函数；产出质量层
 * 与路由层跟宿主强相关，留给各 eval 文件自己写。
 */

import type { TestContext } from "niceeval";
import { isTrue, satisfies } from "niceeval/expect";
import { readCandidateManifest } from "./candidate.ts";

/**
 * 找 agent 把 niceeval 装在了哪。
 *
 * 不假设一定在 workdir 根：python-service 这类非 JS 宿主的正确做法就是
 * 就地新建一个子目录来放 package.json 与三件套，装在子目录里不算错。
 */
async function locateInstall(sandbox: TestContext["sandbox"]): Promise<{ root: string; found: boolean }> {
  const found = await sandbox.runShell(
    `find . -name niceeval.config.ts -not -path '*/node_modules/*' -maxdepth 3 | head -1`,
  );
  const hit = found.stdout.trim();
  if (!hit) return { root: ".", found: false };
  // ./sub/niceeval.config.ts -> sub ; ./niceeval.config.ts -> .
  const dir = hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "");
  return { root: dir === "" ? "." : dir, found: true };
}

/** 数 tsc 输出里属于 agent 自己代码的错误行（`path(line,col): error TSxxxx:`） */
function countOwnTypeErrors(tscOutput: string): number {
  return tscOutput
    .split("\n")
    .filter((line) => /^\S+\(\d+,\d+\): error TS\d+:/.test(line))
    .filter((line) => !line.includes("node_modules")).length;
}

/**
 * 检查 niceeval 是否安装好。这层断言本身跟宿主是谁无关，四条接入路径判的是
 * 同一件事——所以抽成一个函数共用。后续两层（产出质量层的 judge 怎么写、
 * 路由层期望哪几页）跟宿主强相关，不在这里，各 eval 文件自己写。
 */
export async function assertNiceevalInstalled(
  t: TestContext,
  opts: { version: string },
): Promise<void> {
  const sandbox = t.sandbox;
  const layout = await locateInstall(sandbox);
  const at = layout.root;

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
  // 对应一个能加载成功的配置，前缀就是配置 id（如 compare-models/gpt-5.4）——一个
  // 文件存在但加载时报错，dry-run 会直接非零退出、规划数清零，这才是「agent 写的
  // experiment 能不能跑」的真实信号，数 experiments/ 下有几个 .ts 文件骗不了它。
  const dryRun = await sandbox.runShell(`npx --no-install niceeval exp --dry --output ci 2>&1`, { cwd: at });
  const planRows = dryRun.stdout.split("\n").filter((line) => line.startsWith("niceeval: plan-row"));

  const results = await sandbox.runShell(
    `find .niceeval -name 'result.json' 2>/dev/null | head -1`,
    { cwd: at },
  );

  const hasTsconfig = await sandbox.fileExists(`${at === "." ? "" : at + "/"}tsconfig.json`);
  const typecheck = hasTsconfig
    ? await sandbox.runShell(`npx --no-install tsc --noEmit 2>&1`, { cwd: at })
    : null;

  await t.group("检查 niceeval 是否安装好", async () => {
    t.check(layout.found, isTrue("niceeval.config.ts 存在").gate());
    t.check(
      installedVersion === candidate.version,
      isTrue(`依赖解析到候选包（实际：${installedVersion ?? "未安装"}）`).gate(),
    );
    t.check(managed.stdout.trim().length > 0, isTrue("AGENTS.md / CLAUDE.md 里有托管指引区块").gate());
    t.check(list.exitCode, satisfies((c) => c === 0, "niceeval list 退出码为 0").gate());
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
    // compare-models 是 INIT.md 明确要求的默认组织方式，但宿主接口不支持选模型时
    // 允许退化成单实验，所以这里是软分不是 gate
    t.check(
      planRows.some((line) => /\bexperiment=compare-models\//.test(line)),
      isTrue("按 compare-models 实验组组织").atLeast(1),
    );
    // 只作软分：跑通一次实验需要被测应用在沙箱里起得来，这依赖 agent 自己决定
    // 起不起后台进程，波动大；把它 gate 会让「装对了但没顺手跑一次」被判成安装失败。
    t.check(results.stdout.trim().length > 0, isTrue("真的跑出过一次结果（.niceeval 有落盘）").atLeast(1));
  });
}
