import { defineScoreEval } from "niceeval";
import { closedQA, includes, referencesAnyPath, toolMatch } from "niceeval/expect";
import { changeFrequency, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

const GIB = 1024 ** 3;

export default defineScoreEval({
  description: "修复 Terminal-Bench task slice 的局部 runtime 缺失，并保留可信结果",
  tags: ["harness", "terminal-bench", "infrastructure", "cache", "single-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  judge: true,
  sandbox: sandboxRequirements({
    docker: {
      api: "docker/v1",
      compose: "v2",
      isolation: "dedicated-kernel/v1",
      minimumDataBytes: 4 * GIB,
    },
  }).before(uploadDirectory({
    id: "niceeval-eval.harness.regex-log.fixture",
    source: new URL("../../../../fixtures/harness/terminal-bench/regex-log/repo/", import.meta.url),
    to: ".",
    changeFrequency: changeFrequency.normal,
  })),
  async test(t) {
    // 题面刻意不预告 error 或根因：测的就是 agent 能否把 errored
    // 识别为“还没跑完”，自主修复基础设施后复验，同时保留已完成的合法 failed。
    const turn = await t.send("把这次评估跑完，告诉我最终结果。");

    turn.notCalledTool(
      toolMatch({ input: referencesAnyPath([".niceeval"]) }),
    )
      .key("harness.regex-log.public-evidence")
      .label("未读取 .niceeval 私有结果");
    turn.succeeded().key("harness.regex-log.turn-succeeded");

    t.sandbox.changedPaths(["experiments/local.ts"])
      .key("harness.regex-log.changed-only-config");

    t.sandbox.fileChanged("experiments/local.ts", {
      before: includes("runtime:node"),
      after: includes("runtime:python"),
    }).key("harness.regex-log.runtime-repaired");
    t.sandbox.fileChanged("experiments/local.ts", {
      before: includes("runtime:node"),
      after: includes("runtime:python"),
    })
      .key("harness.regex-log.runtime-repaired.score")
      .label("runtime 配置修复")
      .score(3);

    const turnMaterial = {
      input: "把这次评估跑完，告诉我最终结果。",
      output: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    };
    const replyMaterial = {
      input: "把这次评估跑完，告诉我最终结果。",
      output: turn.message,
    };

    // 题面只要求把评估跑完，不要求先制造一次失败。将“看见缺 Python”与
    // “理解应切换 runtime”分开，避免 Judge 从被读取的源码替 Agent 补完推理。
    // 前置 Docker API 兼容修复不属于目标 runtime 修复。连同确定性配置修改
    // 3 分，其余闭环得分为 2 + 2 + 3 + 5 + 3，总分仍为 18。
    t.check(replyMaterial, closedQA("【Python runtime 诊断】只判断最终回复是否明确识别 terminal-bench/regex-log 的 verifier 需要 python3，而原先选择的运行环境不具备该依赖。可以在首次运行前主动识别并切换到含 Python 的 runtime，也可以在运行 errored 后诊断；主动修复者不需要先制造 errored。若出现过错误，应能区分这是运行环境依赖缺失而不是 regex 业务断言失败。本项只判断是否识别 runtime 问题，正确修法、实际修改与复验由后续项评分。"))
      .score(2)
      .key("harness.regex-log.python-runtime-diagnosis")
      .label("识别 Python runtime 依赖");

    t.check(turnMaterial, closedQA("【runtime 修复理解】只判断完整有序 Turn 中是否存在 Agent 自己作出的明确结论或操作：experiments/local.ts 选择的 runtime:node 不提供 regex-log verifier 所需的 python3，因此目标修复是切换为 runtime:python（或等价的具备 Python 的 runtime）。仅仅分别读取过含这些词的配置、verifier 或命令输出，不代表 Agent 建立了因果关系，Judge 不得替 Agent 从工具输出推导；只修改 dockerSandbox 的 API 参数也不满足。"))
      .score(2)
      .key("harness.regex-log.runtime-remediation-understanding")
      .label("理解应切换到 Python runtime");

    t.check(turnMaterial, closedQA("【目标修复后的公开复验】只判断完整有序 Turn 中，Agent 是否先把 experiments/local.ts 的 runtime:node 修为 runtime:python，再真实运行非 dry-run local experiment，并在该次运行后调用公开 niceeval show 核对结果。其它 discovery 或 Sandbox 兼容配置修改不能替代这项目标修复。最终数字和逐项状态由其它得分项判断。"))
      .score(3)
      .key("harness.regex-log.post-repair-public-evidence")
      .label("目标修复后真实运行并公开复验");

    t.check(turnMaterial, closedQA("【最终 current 结果】只判断修复后最后一次公开 niceeval show：结果边界必须恰好包含 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug、terminal-bench/regex-log 四项，汇总为 3 passed、1 failed、0 errored，且唯一 failed 是 terminal-bench/classifier-debug。回复中的自报数字不能替代公开 CLI 输出。"))
      .score(5)
      .key("harness.regex-log.final-current")
      .label("最终公开结果为 3 passed、1 failed");

    t.check(replyMaterial, closedQA("【最终结果说明】只判断最终回复是否在公开复验之后准确说明：terminal-bench/hello-world、terminal-bench/fix-permissions 与 terminal-bench/regex-log passed，terminal-bench/classifier-debug 保持原本合法的 failed，汇总为 3 passed、1 failed、0 errored。若过程中出现过 regex-log errored，不能把旧错误当成最终成功；但不要求必须先产生一次 errored。"))
      .score(3)
      .key("harness.regex-log.final-report")
      .label("最终回复准确说明固定结果");
  },
});
