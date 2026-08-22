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

    // 先由 fixture 跑完 experiment，再让 agent 接手已经停稳的 Record。Agent 可以从安装版本的
    // bundled docs 学公开命令，但历史事实仍必须来自 compact show 与 locator 证据切片。
    // 不开 stream：0.9.x 的多行 agent handoff 经流式 tee 后可能只在返回值里留下首行，
    // 这里需要完整公开汇总做前置判定。
    const initialRun = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "local"],
    );
    const initialOutput = `${initialRun.stdout}\n${initialRun.stderr}`;
    const hasExpectedSummary = initialOutput
      .split(/\r?\n/u)
      .some((line) =>
        /^.*\b1 passed\s+·\s+2 failed\s+·\s+0 errored\s+\(0 reused\)(?:\s*│)?\s*$/u.test(line)
        || /^summary:\s+1 passed,\s+2 failed,\s+0 errored\s+\(0 reused\)\s*$/u.test(line)
        || /^.*1 通过\s+·\s+2 失败\s+·\s+0 出错\s+\(复用 0\)(?:\s*│)?\s*$/u.test(line)
      );
    if (initialRun.exitCode !== 1 || !hasExpectedSummary) {
      throw new Error(
        "log-summary 初始 local experiment 应完整得到 1 passed、2 failed、0 errored " +
          `并返回 exit 1，实测 exit ${initialRun.exitCode}: ` +
          `${initialOutput.trim() || "无输出"}`,
      );
    }

    // 用户只要求归因，没有授权改文件；failed 是已完成的业务结论，不应重跑或“修绿”。
    const input = "刚才的 local 评估已经跑完了，定位一下为什么有两个失败。";
    const turn = await t.send(input);

    turn.notCalledTool(
      toolMatch({ input: referencesAnyPath([".niceeval"]) }),
    )
      .key("harness.log-summary.public-evidence")
      .label("未读取 .niceeval 私有结果");
    turn.succeeded()
      .key("harness.log-summary.turn-succeeded")
      .label("反馈 Turn 成功");

    t.sandbox.noChanges()
      .key("harness.log-summary.no-changes")
      .label("工作区保持不变");

    const turnMaterial = {
      input,
      output: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    };

    t.judge.autoevals.closedQA("【公开 show 与 classifier-debug 归因】local experiment 已由用户跑完。检查完整有序 Turn：Agent 可以读取当前安装版本的 bundled INDEX / docs 以及项目中的 eval/agent 源码，但不得重新运行 experiment，也不得直接读取 .niceeval 私有文件；历史执行与产出事实必须由公开 show 证据确认。Agent 必须先从公开 compact niceeval show 得到 terminal-bench/hello-world、terminal-bench/classifier-debug、terminal-bench/log-summary 的 current 结果为 1 passed、2 failed、0 errored，以及 terminal-bench/classifier-debug 的动态 locator；再对同一个 locator 使用该安装版本公开提供的 Attempt overview、recorded eval/source 与 execution 证据切片。具体 flag 名称不是判分条件，版本缺少的命令也不是替代成功标准。公开证据必须显示 agent 写入选项 B，而该题正确选项与断言要求都是 A；最终回复必须在下钻输出之后建议修正 agent 的选择或推理，不应修改 Eval。不能把 classifier-debug 归因为 Eval 过紧，也不能把 log-summary 归为 agent 结果错误。", turnMaterial)
      .score(7)
      .atLeast(1);

    t.judge.autoevals.closedQA("【公开 show 与 log-summary 归因】local experiment 已由用户跑完。检查完整有序 Turn：Agent 可以读取当前安装版本的 bundled INDEX / docs 以及项目中的 eval/agent 源码，但不得重新运行 experiment，也不得直接读取 .niceeval 私有文件；历史执行与产出事实必须由公开 show 证据确认。Agent 必须先从公开 compact niceeval show 取得 terminal-bench/log-summary 的动态 locator，再对同一个 locator 使用该安装版本公开提供的 Attempt overview、recorded eval/source 与 execution 证据切片；具体 flag 名称不是判分条件。公开证据必须显示 agent 生成的是四行合法 CSV，ERROR/WARNING/INFO 计数分别为 4/3/8，只是字段带有 CSV 允许的双引号；exact Assertion 却逐字要求无引号文本。最终回复必须在下钻输出之后建议改成 CSV 语义判定，不应要求 agent 输出唯一序列化。不能把 log-summary 归因为 agent 结果错误，也不能把 classifier-debug 归为 Eval 过紧。", turnMaterial)
      .score(7)
      .atLeast(1);
  },
});
