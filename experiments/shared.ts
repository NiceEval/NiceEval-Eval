/**
 * 各实验共用的 sandbox 与 agent 装配。
 *
 * 实验之间应该只差一个变量——差别越少，分数差能归因到的东西越明确。
 * 这里只钉死 agent 装配与 sandbox 基线；runs/maxConcurrency 之类的运行档位
 * 各实验自己写，不再共用一个常量。
 */

import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import type { SandboxHook } from "niceeval/sandbox";
import { provisionTargetAppEnv } from "../lib/target-app-env.ts";

/**
 * 默认 template：niceeval 官方发布的 codex template（correctroads-default-team/niceeval-codex）
 * 实测跑的是 Node v20.9.0，不是 assertNodeMajor 要求的 v24——装 niceeval 的链路要跑
 * pnpm / npx / tsc，版本漂移会变成一类跟文档无关的失败噪声。这个 template 在它之上加了
 * Node 24（见 scripts/build-e2b-node24-template.ts），本仓库所有 eval 的共同基线。
 *
 * 重新烘焙后把这个字符串换成新 tag；同时更新 build-e2b-python-template.ts 里的 BASE_TEMPLATE，
 * 否则 Python 组会从旧 tag 继续派生。
 */
const NICEEVAL_EVAL_CODEX_NODE24_E2B_TEMPLATE = "niceeval-eval-codex-node24:2026-07-20";

/**
 * Python 环境 profile 用的 template：从上面那个 Node 24 template 派生（不是直接从原始
 * codex template），烘焙了 DB-GPT / GPT Researcher / Vanna 三条接入路径要用的 Python 工具链
 * （见 scripts/build-e2b-python-template.ts）。只有声明了 `environment: "python"` 的 eval
 * 才会落到这个 template；没声明的（包括以后新增的 TS 项目 eval）用默认 template，不会被
 * 拖慢也不需要 apt/root。
 *
 * 重新烘焙后把这个字符串换成新 tag，不用改调用方。
 */
const NICEEVAL_EVAL_PYTHON_E2B_TEMPLATE = "niceeval-eval-python:2026-07-20";

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
          `exit ${result.exitCode}）：这个 e2b template 没有烘焙预期的 Node 版本，或 PATH 上` +
          `不是它。装 niceeval 的链路要跑 pnpm / npx / tsc，版本漂移会被误判成文档没起作用。`,
      );
    }
    ctx.progress({ message: `Node 版本核对通过：${result.stdout.trim()}` });
  };
}

/**
 * sandbox 基线：e2b + 本仓库自己烘焙的 Node 24 template（已带 codex CLI，attempt 里不用
 * 再装一遍）。apt/root 能力（provisionTargetAppEnv 要用）来自这个 template 的官方 codex
 * 基线，Node 版本由这层烘焙保证——即便如此仍然实测验证，见 assertNodeMajor：版本不对会在
 * setup 阶段就响，不会静默漂移成后面一类查不出根因的失败。
 *
 * 不带候选版本参数：安装前引导文档不再由 harness 投放进沙箱，eval 直接让 agent 读
 * `candidateInitDocUrl(version)`（见 lib/candidate.ts）。这份 sandbox 基线因此对候选版本
 * 无感——版本只活在 experiment 的 `flags.candidateVersion` 与 eval 的 `t.send()` 里，
 * 不用再在两处（sandbox 装配 + flags）之间手动保持同步。
 *
 * `environments.python` 给声明了 `environment: "python"` 的 eval（DB-GPT / GPT Researcher /
 * Vanna 三条接入路径）换成烘焙好 Python 工具链的 template；其余 eval 落回默认 template。
 */
export function sandboxWith() {
  return e2bSandbox({
    template: NICEEVAL_EVAL_CODEX_NODE24_E2B_TEMPLATE,
    environments: { python: { template: NICEEVAL_EVAL_PYTHON_E2B_TEMPLATE } },
  })
    .setup(assertNodeMajor(24))
    .setup(provisionTargetAppEnv());
}
