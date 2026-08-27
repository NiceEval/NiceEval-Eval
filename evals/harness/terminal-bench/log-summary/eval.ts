import { defineScoreEval } from "niceeval";
import { closedQA, referencesAnyPath, toolMatch } from "niceeval/expect";
import { changeFrequency, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

const GIB = 1024 ** 3;

export default defineScoreEval({
  description: "只凭公开结果区分 Terminal-Bench agent 产出错误与过紧 eval",
  tags: ["harness", "terminal-bench", "diagnosis", "failed", "single-turn"],
  timeoutMs: 20 * 60 * 1000,
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
    id: "niceeval-eval.harness.log-summary.fixture",
    source: new URL("../../../../fixtures/harness/terminal-bench/log-summary/repo/", import.meta.url),
    to: ".",
    changeFrequency: changeFrequency.normal,
  })),
  async test(t) {
    // 先由 fixture 跑完 experiment，再让 agent 接手已经停稳的 Record。Agent 可以从安装版本的
    // bundled docs 学公开命令，但历史事实仍必须来自 compact show 与 locator 证据切片。
    // 不开 stream：这里需要完整公开汇总做前置判定，避免流式 tee 的返回值缺少尾部内容。
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

    // 每个失败各 7 分：公开证据链 2 分、最终任务事实 2 分、责任归因 3 分。
    // 两题都不能只凭复述 actual / expected mismatch 获得归因分；最终回复必须
    // 明确判断责任在错误的 agent 结果，还是在拒绝合法结果的过紧 Eval。
    t.check(turnMaterial, closedQA("【classifier-debug 公开证据】只判断完整有序 Turn 是否形成这条公开证据链：先用 niceeval show 确认 current 为 1 passed、2 failed、0 errored，并取得 terminal-bench/classifier-debug 的动态 locator；再用该 locator 的公开下钻输出确认 agent 写入 B、正确答案与断言要求都是 A。"))
      .score(2)
      .key("harness.log-summary.classifier-evidence")
      .label("classifier-debug 公开证据完整");

    t.check(replyMaterial, closedQA("【classifier-debug 最终任务事实】只判断最终回复是否明确说明 terminal-bench/classifier-debug 的 agent 实际选择或写入 B，而题目正确答案与 Eval 期望都是 A。只需判断事实是否说清，不在本项判断责任归因。"))
      .score(2)
      .key("harness.log-summary.classifier-answer-fact")
      .label("classifier-debug 最终事实正确");

    t.check(replyMaterial, closedQA("【classifier-debug 最终责任归因】只判断最终回复是否把 terminal-bench/classifier-debug 的失败解释为：题目正确要求或有效判据是 A，而 agent/canned answer 选择了 B，因此 agent 结果没有满足题目。明确作出这条因果对比即满足，不要求额外使用‘agent 错误’等固定措辞。若回复质疑 A 是正确要求、把责任归为 Eval 对 A 的要求过紧，或没有把 B 与题目要求 A 连接起来，则不满足。"))
      .score(3)
      .key("harness.log-summary.classifier-agent-attribution")
      .label("classifier-debug 最终归因 agent 答案错误");

    t.check(turnMaterial, closedQA("【log-summary 公开证据】只判断完整有序 Turn 是否形成这条公开证据链：从 niceeval show 取得 terminal-bench/log-summary 的动态 locator；再用该 locator 的公开下钻输出确认 agent 生成四行合法 CSV，ERROR/WARNING/INFO 为 4/3/8，实际差异只是 CSV 字段带有允许的双引号，而 exact Assertion 要求无引号文本。"))
      .score(2)
      .key("harness.log-summary.log-evidence")
      .label("log-summary 公开证据完整");

    t.check(replyMaterial, closedQA("【log-summary 最终任务事实】只判断最终回复是否明确说明 terminal-bench/log-summary 的 ERROR/WARNING/INFO 计数为 4/3/8，且带双引号的四行产物仍是满足题面要求的合法 CSV，因此任务结果本身正确。只说‘输出带引号、与 exact 文本不同’而没有肯定其合法且满足题面，必须判为不满足。"))
      .score(2)
      .key("harness.log-summary.log-result-valid")
      .label("log-summary 最终确认任务结果正确");

    t.check(replyMaterial, closedQA("【log-summary 最终责任归因】只判断最终回复是否明确得出 terminal-bench/log-summary 的失败责任在 Eval：它用过紧的精确字符串断言拒绝了题面允许的合法 CSV。若回复称这是 agent 输出错误、称‘并非 NiceEval/Eval 问题’，或只描述引号与 exact 文本的差异而没有把判据定性为过紧，必须判为不满足。题面没有要求修复建议，是否附带建议不属于本项。"))
      .score(3)
      .key("harness.log-summary.log-eval-attribution")
      .label("log-summary 最终归因 Eval 过紧");
  },
});
