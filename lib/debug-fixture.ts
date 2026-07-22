/**
 * debug eval 共用的沙箱准备:上传只读 fixture、装候选版本、按 flag 决定要不要跑 init。
 *
 * 每条题各自一个独立的 eval 文件(见 evals/debug/*.eval.ts),问题、标准答案、判据都各写各的
 * ——这里只留三条题都要做的同一段准备步骤,不再用一个通用 factory 把它们揉进一份配置里。
 */

import type { StreamEvent, TestContext } from "niceeval";

/** fixture 目录(相对各 eval 文件),含最小宿主配置 + 整目录签入的 .niceeval,数据永不重跑 */
export const DEBUG_FIXTURE_DIR = "../../fixtures/results/coding-agent-memory";

/**
 * 上传只读 fixture 并装好候选版本。
 *
 * 装版本这步覆盖 fixture package.json 里那行导出时原样抄来的 `niceeval: ^0.8.0`——照它装
 * 会从 npm 拉一个跟候选无关的版本,路由层就会去量那个版本的随包文档。
 *
 * `withAgentRules`(读自 t.flags.agentRules)是这组评估唯一的自变量:AGENTS.md 里有没有
 * `niceeval init` 写的托管区块——那段区块把 agent 指向 `node_modules/niceeval/INDEX.md`,
 * 是随包文档机制的入口。两组实验(experiments/debug/with-agent-rules.ts / no-agent-rules.ts)
 * 各设一次这个 flag,题面完全相同,差异只在这段指针在不在。
 */
export async function prepareDebugSandbox(t: TestContext): Promise<void> {
  const version = t.flags.candidateVersion as string;

  await t.sandbox.uploadDirectory(DEBUG_FIXTURE_DIR);

  const install = await t.sandbox.runCommand("pnpm", ["add", "-D", `niceeval@${version}`]);
  if (install.exitCode !== 0) {
    throw new Error(
      `候选包装不上,后面每一步失败都会被误判成 agent 不会查:\n${install.stderr || install.stdout}`,
    );
  }

  const withAgentRules = t.flags.agentRules !== false;
  if (withAgentRules) {
    const init = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "init"]);
    if (init.exitCode !== 0) {
      throw new Error(`niceeval init 没跑成,实验组的自变量就没立起来:\n${init.stderr || init.stdout}`);
    }
  }
}

/** 反模式判据:agent 有没有绕开 niceeval show,徒手翻 .niceeval 下的原始 JSON */
export function readRawJson(events: readonly StreamEvent[]): boolean {
  const haystack = events.map((e) => JSON.stringify(e)).join("\n");
  return /\.niceeval\/[\w./-]*\.json/.test(haystack);
}
