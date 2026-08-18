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
    // 先由 fixture 跑完 experiment，再让 agent 接手已经停稳的 Record。反馈阶段不需要重新
    // 学 CLI 或检查 package scripts：公开 compact show 就是稳定入口。
    const initialRun = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "local"],
      { stream: true },
    );
    if (initialRun.exitCode !== 1) {
      throw new Error(
        `log-summary 初始 local experiment 应以 2 failed 返回 exit 1，实测 exit ${initialRun.exitCode}: ` +
          `${initialRun.stderr.trim() || initialRun.stdout.trim() || "无输出"}`,
      );
    }

    // 用户只要求归因，没有授权改文件；failed 是已完成的业务结论，不应重跑或“修绿”。
    const input = "刚才的 local 评估已经跑完了，定位一下为什么有两个失败。";
    const turn = await t.send(input);

    turn.notCalledTool(
      toolMatch({ input: referencesAnyPath([".niceeval", "evals", "agents"]) }),
    )
      .key("harness.log-summary.public-evidence")
      .label("未读取私有结果或评估源码");
    turn.notCalledTool(
      toolMatch({
        input: referencesAnyPath([
          "package.json",
          "AGENTS.md",
          "CLAUDE.md",
          "INIT.md",
          "node_modules/niceeval",
        ]),
      }),
    )
      .key("harness.log-summary.direct-show-no-doc-reading")
      .label("未读取项目或 NiceEval 指引");
    turn.succeeded()
      .key("harness.log-summary.turn-succeeded")
      .label("反馈 Turn 成功");

    t.sandbox.noChanges()
      .key("harness.log-summary.no-changes")
      .label("工作区保持不变");
    t.sandbox.noChanges()
      .key("harness.log-summary.no-changes.score")
      .label("没有越界修改")
      .score(2);

    const turnMaterial = {
      input,
      output: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    };

    t.judge.autoevals.closedQA(`【直接 show 与 classifier-debug 归因】local experiment 已由用户跑完。检查完整有序 Turn：Agent 的第一个 NiceEval 取证动作必须直接运行公开 compact niceeval show，不能重新运行 experiment，不能先读 INDEX、CLI 文档、package scripts、AGENTS/INIT、源码或 .niceeval 落盘文件来学习怎样查看结果，也不能误用 pnpm show。该 compact show 必须给出 terminal-bench/hello-world、terminal-bench/classifier-debug、terminal-bench/log-summary 的 current 结果为 1 passed、2 failed、0 errored，并给出 terminal-bench/classifier-debug 的动态 locator；后续 ${candidateVersion.startsWith("0.9.") ? "--eval" : "--source"} 与 --execution 必须在 compact show 之后使用同一个 locator。证据必须显示 agent 写入选项 B，而该题正确选项与断言要求都是 A；最终回复必须在下钻输出之后建议修正 agent 的选择或推理，不应修改 Eval。不能把 classifier-debug 归因为 Eval 过紧，也不能把 log-summary 归为 agent 结果错误。`, turnMaterial)
      .score(6)
      .atLeast(1);

    t.judge.autoevals.closedQA(`【直接 show 与 log-summary 归因】local experiment 已由用户跑完。检查完整有序 Turn：Agent 必须直接从公开 compact niceeval show 取得 terminal-bench/log-summary 的动态 locator，不得重新运行 experiment，不得先读 NiceEval 文档、package scripts、项目指引、源码或私有结果文件，也不得误用 pnpm show；再让 ${candidateVersion.startsWith("0.9.") ? "--eval" : "--source"} 与 --execution 在 compact show 之后使用同一个 locator。证据必须显示 agent 生成的是四行合法 CSV，ERROR/WARNING/INFO 计数分别为 4/3/8，只是字段带有 CSV 允许的双引号；exact Assertion 却逐字要求无引号文本。最终回复必须在下钻输出之后建议改成 CSV 语义判定，不应要求 agent 输出唯一序列化。不能把 log-summary 归因为 agent 结果错误，也不能把 classifier-debug 归为 Eval 过紧。`, turnMaterial)
      .score(6)
      .atLeast(1);
  },
});
