/**
 * 各实验共用的 sandbox 与 agent 装配。
 *
 * 实验之间应该只差一个变量——差别越少，分数差能归因到的东西越明确。
 * 这里只钉死 agent 装配与 sandbox 基线；runs/maxConcurrency 之类的运行档位
 * 各实验自己写，不再共用一个常量。
 */

import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import type { SandboxHook } from "niceeval/sandbox";
import { provisionTargetAppEnv } from "../lib/fixture-env.ts";

/** 被测 coding agent。模型写在各实验的 model 字段，不写在这里。 */
export const agentUnderTest = codexAgent();

/**
 * docker 下 runtime 能在创建时钉死（选 `node:24-slim` 镜像），e2b 不能——
 * `E2BSandboxSpec.runtime` 只作记录，Node 版本由 template 决定。换成 e2b 后
 * 这条钉子就没了结构性保证，只能在 setup 阶段现查现断言：查到的版本不对，
 * 就在这里响，而不是让它在后面变成一类跟文档无关的失败噪声（诊断成本比这条
 * 检查本身贵得多）。
 */
function assertNodeMajor(major: number): SandboxHook {
  return async (sandbox, ctx) => {
    const result = await sandbox.runCommand("node", ["-v"]);
    const match = /^v(\d+)\./.exec(result.stdout.trim());
    const found = match ? Number(match[1]) : undefined;
    if (found !== major) {
      throw new Error(
        `sandbox 里的 Node 版本不是 v${major}.x（实测 ${result.stdout.trim() || "<empty>"}，` +
          `exit ${result.exitCode}）：${NICEEVAL_CODEX_E2B_TEMPLATE} 这个 e2b template 没有` +
          `烘焙预期的 Node 版本，或 PATH 上不是它。装 niceeval 的链路要跑 pnpm / npx / tsc，` +
          `版本漂移会被误判成文档没起作用。`,
      );
    }
    ctx.progress({ message: `Node 版本核对通过：${result.stdout.trim()}` });
  };
}

/**
 * sandbox 基线：e2b + NiceEval 官方发布的 Codex template（已烘焙 codex CLI，attempt 里
 * 不用再装一遍）。node 版本、apt/root 能力（provisionTargetAppEnv 要用）都来自这个 template，
 * 没有在本仓库里实测验证过——见 assertNodeMajor，版本不对会在 setup 阶段就响，不会静默
 * 漂移成后面一类查不出根因的失败。
 *
 * 不带候选版本参数：安装前引导文档不再由 harness 投放进沙箱，eval 直接让 agent 读
 * `candidateInitDocUrl(version)`（见 lib/candidate.ts）。这份 sandbox 基线因此对候选版本
 * 无感——版本只活在 experiment 的 `flags.candidateVersion` 与 eval 的 `t.send()` 里，
 * 不用再在两处（sandbox 装配 + flags）之间手动保持同步。
 */
export function sandboxWith() {
  return e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE })
    .setup(assertNodeMajor(24))
    .setup(provisionTargetAppEnv());
}
