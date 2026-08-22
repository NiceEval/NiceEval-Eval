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

    t.judge.autoevals.closedQA("【classifier-debug 归因】检查完整有序 Turn。取证黑名单只有直接读取 .niceeval 原始文件；命中黑名单即不满足，除此之外读取哪些文件或文档不作为判分条件。local experiment 已由用户跑完，Agent 不应重新运行；必须用公开 niceeval show 确认 current 结果为 1 passed、2 failed、0 errored，取得 terminal-bench/classifier-debug 的动态 locator，并用该 locator 的公开下钻证据确认 agent 写入 B、正确答案与断言要求都是 A。最终回复必须把 classifier-debug 判为 agent 答案错误，不能判成 Eval 过紧，也不能混淆另一个失败的原因。", turnMaterial)
      .score(7)
      .atLeast(1);

    t.judge.autoevals.closedQA("【log-summary 归因】检查完整有序 Turn。取证黑名单只有直接读取 .niceeval 原始文件；命中黑名单即不满足，除此之外读取哪些文件或文档不作为判分条件。local experiment 已由用户跑完，Agent 不应重新运行；必须从公开 niceeval show 取得 terminal-bench/log-summary 的动态 locator，并用该 locator 的公开下钻证据确认输出是四行合法 CSV，ERROR/WARNING/INFO 计数为 4/3/8，只是字段带有 CSV 允许的双引号，而 exact Assertion 逐字要求无引号文本。最终回复必须把 log-summary 判为 Eval 精确字符串条件过紧，不能判成 agent 统计或任务结果错误，也不能混淆另一个失败的原因。", turnMaterial)
      .score(7)
      .atLeast(1);
  },
});
