/**
 * debug eval 共用的沙箱准备:上传只读 fixture、装候选版本、按 flag 决定要不要跑 init。
 *
 * 每条题各自一个独立的 eval 文件(见 evals/debug/*.eval.ts),问题、标准答案、判据都各写各的
 * ——这里只留三条题都要做的同一段准备步骤,不再用一个通用 factory 把它们揉进一份配置里。
 *
 * 这个文件放在 evals/debug/share/ 而不是顶层 lib/:它只服务 debug 这一组 eval,不是跨组
 * 通用件——lib/ 留给 routing.ts / candidate.ts 这类装/查/接入路径都要用的东西。
 */

import type { TestContext } from "niceeval";

/** fixture 目录(相对各 eval 文件),含最小宿主配置 + 整目录签入的 .niceeval,数据永不重跑 */
export const DEBUG_FIXTURE_DIR = "../../../fixtures/results/coding-agent-memory";

/**
 * 一次具体的失败 attempt:memory/agent-029-use-cache-directive 这条 eval 在
 * compare/codex-gpt-5.6-luna--agents-md 下失败了,那次 attempt 的 locator 是 @1csayr61。
 *
 * failed-assertion(定位它)与 agent-approach(深挖它)两条 eval 都围着这同一次失败出题,
 * 三个字段只在这一处写——fixture 重新导出、locator 变了,只用改这一处,不用两个文件各改一次。
 */
export const USE_CACHE_FAILURE = {
  evalId: "memory/agent-029-use-cache-directive",
  expId: "compare/codex-gpt-5.6-luna--agents-md",
  locator: "@1csayr61",
};

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

/**
 * 反模式判据:agent 绕开 niceeval show、徒手翻 .niceeval 下的原始 JSON。
 * 配 `t.notCalledTool("shell", { input: { command: RAW_JSON_RE } })` 只测调用入参——
 * 回复里提到路径、工具输出里出现路径都不算翻(旧版扫全事件流会把这两种都误记)。
 */
export const RAW_JSON_RE = /\.niceeval\/[\w./-]*\.json/;
