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
    const replyMaterial = {
      input,
      output: turn.message,
    };

    // 每个失败各 7 分：公开证据链 2 分，最终归因 5 分。事实识别已经在
    // 证据项中独立计分，归因项只做一个二元语义判断，避免完整双项回复被
    // factuality 误判为单项参考答案的 superset 或 disagreement。
    t.judge.autoevals.closedQA("【classifier-debug 公开证据】只判断完整有序 Turn 是否形成这条公开证据链：先用 niceeval show 确认 current 为 1 passed、2 failed、0 errored，并取得 terminal-bench/classifier-debug 的动态 locator；再用该 locator 的公开下钻输出确认 agent 写入 B、正确答案与断言要求都是 A。", turnMaterial)
      .score(2)
      .key("harness.log-summary.classifier-evidence")
      .label("classifier-debug 公开证据完整");

    t.judge.autoevals.closedQA("【classifier-debug 最终归因】只判断最终回复是否明确把 terminal-bench/classifier-debug 归因为 agent 选择 B、而正确答案与 Eval 都要求 A 所造成的 agent 答案错误；不能归因为 Eval 条件过紧。", replyMaterial)
      .score(5)
      .key("harness.log-summary.classifier-diagnosis")
      .label("classifier-debug 最终归因正确");

    t.judge.autoevals.closedQA("【log-summary 公开证据】只判断完整有序 Turn 是否形成这条公开证据链：从 niceeval show 取得 terminal-bench/log-summary 的动态 locator；再用该 locator 的公开下钻输出确认 agent 生成四行合法 CSV，ERROR/WARNING/INFO 为 4/3/8，实际差异只是 CSV 字段带有允许的双引号，而 exact Assertion 要求无引号文本。", turnMaterial)
      .score(2)
      .key("harness.log-summary.log-evidence")
      .label("log-summary 公开证据完整");

    t.judge.autoevals.closedQA("【log-summary 最终归因】只判断最终回复是否明确把 terminal-bench/log-summary 归因为 Eval 对合法且计数正确的 CSV 使用了过紧的精确字符串断言；不能把主要原因归为 agent 统计或任务结果错误。题面没有要求修复建议，是否附带建议不属于本项。", replyMaterial)
      .score(5)
      .key("harness.log-summary.log-diagnosis")
      .label("log-summary 最终归因正确");
  },
});
