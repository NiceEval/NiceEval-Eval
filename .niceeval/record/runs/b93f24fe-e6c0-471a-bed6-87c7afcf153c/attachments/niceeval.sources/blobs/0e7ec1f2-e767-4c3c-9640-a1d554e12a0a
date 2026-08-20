import { defineScoreEval } from "niceeval";
import { referencesAnyPath, toolMatch } from "niceeval/expect";

export default defineScoreEval({
  description: "只凭公开结果区分 Terminal-Bench agent 产出错误与过紧 eval",
  tags: ["harness", "terminal-bench", "diagnosis", "failed", "single-turn"],
  timeoutMs: 20 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  judge: true,
  async test(t) {
    await t.sandbox.uploadDirectory(
      new URL("../../../../fixtures/harness/terminal-bench/log-summary/repo/", import.meta.url),
      ".",
    );

    const candidateVersion = String(t.flags.candidateVersion);
    // 用户只要求运行和归因，没有授权改文件；failed 是已完成的业务结论，
    // 这道题测的是 agent 能否区分产出错误与过紧断言，而不是把所有红灯修绿。
    const turn = await t.send("把这次评估跑一下，告诉我每个失败的原因。");

    turn.notCalledTool(
      toolMatch({ input: referencesAnyPath([".niceeval", "evals", "agents"]) }),
    ).key("harness.log-summary.public-evidence");
    turn.succeeded().key("harness.log-summary.turn-succeeded");

    t.sandbox.noChanges().key("harness.log-summary.no-changes");
    t.sandbox.noChanges()
      .key("harness.log-summary.no-changes.score")
      .label("没有越界修改")
      .score(2);

    const turnMaterial = {
      input: "把这次评估跑一下，告诉我每个失败的原因。",
      output: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    };

    t.judge.autoevals.closedQA(`【classifier-debug 归因】检查完整有序 Turn：Agent 必须先真实运行一次非 dry-run 的 local experiment，再用公开 compact show 取得 terminal-bench/hello-world、terminal-bench/classifier-debug、terminal-bench/log-summary 的首次结果为 1 passed、2 failed、0 errored，并给出 terminal-bench/classifier-debug 的动态 locator；后续 ${candidateVersion.startsWith("0.9.") ? "--eval" : "--source"} 与 --execution 必须在该 compact show 输出之后使用同一个 locator。证据必须显示 agent 写入选项 B，而该题正确选项与断言要求都是 A；最终回复必须在下钻输出之后建议修正 agent 的选择或推理，不应修改 Eval。不能把 classifier-debug 归因为 Eval 过紧，也不能把 log-summary 归为 agent 结果错误。`, turnMaterial)
      .score(6)
      .atLeast(1);

    t.judge.autoevals.closedQA(`【log-summary 归因】检查完整有序 Turn：同一次先真实运行的 non-dry-run local experiment 必须随后由公开 compact show 检查；Agent 必须从该 show 取得 terminal-bench/log-summary 的动态 locator，再让 ${candidateVersion.startsWith("0.9.") ? "--eval" : "--source"} 与 --execution 在该输出之后使用同一个 locator。证据必须显示 agent 生成的是四行合法 CSV，ERROR/WARNING/INFO 计数分别为 4/3/8，只是字段带有 CSV 允许的双引号；exact Assertion 却逐字要求无引号文本。最终回复必须在下钻输出之后建议改成 CSV 语义判定，不应要求 agent 输出唯一序列化。不能把 log-summary 归因为 agent 结果错误，也不能把 classifier-debug 归为 Eval 过紧。`, turnMaterial)
      .score(6)
      .atLeast(1);
  },
});
