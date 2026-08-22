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

    t.judge.autoevals.closedQA("【最终 current 结果】检查完整有序 Turn。取证黑名单只有直接读取 .niceeval 原始文件；命中黑名单即不满足，除此之外读取哪些文件或文档不作为判分条件。Agent 必须先真实运行非 dry-run local experiment、经公开 show 诊断后才修复，并在修复后再次真实运行，再用最后一次 niceeval show 核对 current 结果。该最后公开输出必须恰好是 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug、terminal-bench/regex-log 四项，其中 3 passed、1 failed、0 errored；唯一 failed 是原本就合法的 terminal-bench/classifier-debug，不能用回复中的自报数字代替 CLI 证据，最终回复也必须在这次复验 show 之后说明结论。", turnMaterial)
      .score(3)
      .atLeast(1);

    t.judge.autoevals.closedQA("【公开 history 语义正确】检查完整有序 Turn。取证黑名单只有直接读取 .niceeval 原始文件；命中黑名单即不满足，除此之外读取哪些文件或文档不作为判分条件。只依据真实运行与公开 show 判断：最终固定结果边界必须恰好包含四项，terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/regex-log passed，terminal-bench/classifier-debug 保持原本合法的 failed；首次运行中 errored 的 terminal-bench/regex-log 不能被当成成功结果，必须产生修复后的真实 passed。形成该历史边界的具体策略和命令不作为判分条件。最终回复必须在最终公开证据之后说明结论，不能用回复自报补证据。", turnMaterial)
      .score(6)
      .atLeast(1);

    t.judge.autoevals.closedQA("【根因、范围与修复闭环】检查完整有序 Turn。取证黑名单只有直接读取 .niceeval 原始文件；命中黑名单即不满足，除此之外读取哪些文件或文档不作为判分条件。Agent 必须先真实运行非 dry-run local experiment，再从公开 Run/show 取得 errored terminal-bench/regex-log 的动态 locator，并用该 locator 的公开下钻证据证明根因是 runtime 缺少 Python。Agent 只能修改基础设施配置，把 experiments/local.ts 的 runtime:node 修为 runtime:python，不得修改 eval、agent 或历史 Record。修复后必须复验到最终固定结果为 3 passed、1 failed、0 errored，并保留 terminal-bench/classifier-debug 原本合法的 failed；最终回复必须在复验输出之后说明这些依据。", turnMaterial)
      .score(4)
      .atLeast(1);
  },
});
