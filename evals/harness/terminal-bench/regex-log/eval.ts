import { defineScoreEval } from "niceeval";
import { includes, referencesAnyPath, toolMatch } from "niceeval/expect";

export default defineScoreEval({
  description: "修复 Terminal-Bench task slice 的局部 runtime 缺失，并保留可信结果",
  tags: ["harness", "terminal-bench", "infrastructure", "cache", "single-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  judge: true,
  async test(t) {
    await t.sandbox.uploadDirectory(
      new URL("../../../../fixtures/harness/terminal-bench/regex-log/repo/", import.meta.url),
      ".",
    );

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
      .score(5);

    const turnMaterial = {
      input: "把这次评估跑完，告诉我最终结果。",
      output: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    };
    const replyMaterial = {
      input: "把这次评估跑完，告诉我最终结果。",
      output: turn.message,
    };

    // 题面只要求把评估跑完，不要求先制造一次失败。根因可以从配置与 verifier
    // 主动识别，也可以在 errored 后经公开 show 诊断；前置版本兼容修复不影响得分。
    // 连同确定性 runtime 修复 5 分，其余闭环得分为 4 + 1 + 3 + 5，总分仍为 18。
    t.judge.autoevals.closedQA("【runtime 根因理解】只判断完整有序 Turn 是否以项目配置、verifier 或公开 show 为依据，正确识别 terminal-bench/regex-log 需要 Python verifier，而 runtime:node 缺少 python3，因此必须使用具备 Python 的 runtime 才能完成。可以在首次运行前主动识别，也可以在 errored 后诊断；不要求先制造失败、取得动态 locator，或在其它文件修改前完成。只有最终回复中的无依据自报不满足本项。", turnMaterial)
      .score(4)
      .key("harness.regex-log.runtime-root-cause")
      .label("正确识别 Python runtime 根因");

    t.judge.autoevals.closedQA("【目标修复后的公开复验】只判断完整有序 Turn 中，Agent 是否先把 experiments/local.ts 的 runtime:node 修为 runtime:python，再真实运行非 dry-run local experiment，并在该次运行后调用公开 niceeval show 核对结果。其它 discovery 或 Sandbox 兼容配置修改不能替代这项目标修复。最终数字和逐项状态由其它得分项判断。", turnMaterial)
      .score(1)
      .key("harness.regex-log.post-repair-public-evidence")
      .label("目标修复后真实运行并公开复验");

    t.judge.autoevals.closedQA("【最终 current 结果】只判断修复后最后一次公开 niceeval show：结果边界必须恰好包含 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug、terminal-bench/regex-log 四项，汇总为 3 passed、1 failed、0 errored，且唯一 failed 是 terminal-bench/classifier-debug。回复中的自报数字不能替代公开 CLI 输出。", turnMaterial)
      .score(3)
      .key("harness.regex-log.final-current")
      .label("最终公开结果为 3 passed、1 failed");

    t.judge.autoevals.closedQA("【最终结果说明】只判断最终回复是否在公开复验之后准确说明：terminal-bench/hello-world、terminal-bench/fix-permissions 与 terminal-bench/regex-log passed，terminal-bench/classifier-debug 保持原本合法的 failed，汇总为 3 passed、1 failed、0 errored。若过程中出现过 regex-log errored，不能把旧错误当成最终成功；但不要求必须先产生一次 errored。", replyMaterial)
      .score(5)
      .key("harness.regex-log.final-report")
      .label("最终回复准确说明固定结果");
  },
});
