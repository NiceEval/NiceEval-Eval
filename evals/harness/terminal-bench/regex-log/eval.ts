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

    // 过程闭环拆成四个独立的二元得分项；最终 history 说明用 factuality
    // 折算部分覆盖分。连同上面的确定性 runtime 修复 5 分，总分仍为 18。
    t.judge.autoevals.closedQA("【首次公开诊断入口】只判断完整有序 Turn 中，Agent 是否在修改文件前先真实运行非 dry-run local experiment，再从公开 Run/show 取得 errored terminal-bench/regex-log 的动态 locator。", turnMaterial)
      .score(1)
      .key("harness.regex-log.initial-public-evidence")
      .label("修改前取得公开失败 locator");

    t.judge.autoevals.closedQA("【runtime 根因公开证据】只判断完整有序 Turn 中，Agent 是否在修改文件前用同一个 regex-log locator 的公开下钻输出证明 errored 根因是 runtime 缺少 Python。", turnMaterial)
      .score(3)
      .key("harness.regex-log.runtime-root-cause")
      .label("公开下钻证明 runtime 缺少 Python");

    t.judge.autoevals.closedQA("【修复后公开复验入口】只判断完整有序 Turn 中，Agent 是否在修改 runtime 配置后再次真实运行非 dry-run local experiment，并在该次运行后调用公开 niceeval show 核对结果。最终数字和逐项状态由其它得分项判断。", turnMaterial)
      .score(1)
      .key("harness.regex-log.post-repair-public-evidence")
      .label("修复后真实运行并公开复验");

    t.judge.autoevals.closedQA("【最终 current 结果】只判断修复后最后一次公开 niceeval show：结果边界必须恰好包含 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug、terminal-bench/regex-log 四项，汇总为 3 passed、1 failed、0 errored，且唯一 failed 是 terminal-bench/classifier-debug。回复中的自报数字不能替代公开 CLI 输出。", turnMaterial)
      .score(3)
      .key("harness.regex-log.final-current")
      .label("最终公开结果为 3 passed、1 failed");

    t.judge.autoevals.factuality("首次运行中的 terminal-bench/regex-log 是 errored，不能当作成功结果；修复 runtime 后它产生了新的真实 passed 结果。terminal-bench/hello-world 与 terminal-bench/fix-permissions 保持 passed，terminal-bench/classifier-debug 保持原本合法的 failed，没有被误报为成功或修绿。", replyMaterial)
      .score(5)
      .key("harness.regex-log.history-diagnosis")
      .label("最终回复正确解释结果历史");
  },
});
