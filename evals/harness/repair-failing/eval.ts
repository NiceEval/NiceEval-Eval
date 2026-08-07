import { defineScoreEval } from "niceeval";
import { commandSucceeded, excludes, includes, isTrue } from "niceeval/expect";

const EXPECTED_REFUND_ANSWER = "Customers may request a refund within 30 days of purchase.";
const INITIAL_REFUND_ANSWER = "Customers may request a refund within 14 days of purchase.";
const NICEEVAL_LOCAL_COMMAND = /\bniceeval(?:@\S+)?\s+(?:--\s+)?exp\s+local\b/i;
const NICEEVAL_SHOW_COMMAND = /\bniceeval(?:@\S+)?\s+(?:--\s+)?show\b/i;

export default defineScoreEval({
  description: "从同一批 failed 中区分业务实现错误与过期 eval，并按正确层修复后全量复验",
  tags: ["harness", "repair", "failed", "causal", "multi-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  async test(t) {
    // 候选镜像只带共享依赖；把本题自己的起始 repo 铺进当前 attempt 的 workspace 根目录。
    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/repair-failing/repo/", import.meta.url),
      ".",
    );

    const turn1 = await t.send("先调查 local experiment 的失败，判断每一处到底该改哪一层；暂时别改。");

    turn1.calledTool("shell", { input: { command: NICEEVAL_LOCAL_COMMAND } }).points(1).gate();
    turn1
      .calledTool("shell", {
        input: { command: NICEEVAL_SHOW_COMMAND },
        status: "completed",
      })
      .points(1)
      .gate();
    // TODO(niceeval): 等待 eventOrder 支持带数据的 event group matcher。
    turn1.eventOrder([
      { type: "tool", name: "shell", input: { command: NICEEVAL_LOCAL_COMMAND } },
      {
        type: "tool",
        name: "shell",
        input: { command: NICEEVAL_SHOW_COMMAND },
        status: "completed",
      },
      { type: "message", role: "assistant" },
    ]).points(1).gate();
    turn1.judge.autoevals
      .closedQA(
        "只判断本轮有序工具调用。必须确认助手以可分别观察的工具调用先运行非 dry-run 的完整 niceeval exp local，后使用 niceeval show 或带 locator 的等价 NiceEval 查看命令下钻失败；只读源码、只跑 dry-run、把两步藏进同一个 shell 调用或没有下钻都判 N。",
        { on: JSON.stringify(turn1.toolCalls) },
      )
      .points(2)
      .gate();
    turn1.judge.autoevals
      .closedQA(
        "只判断本轮 NiceEval 工具输出。必须由真实输出支持：完整 local 共 5 个 eval，3 passed、2 failed、0 errored；失败是 policy/refund 与 policy/warranty；下钻证据分别显示 refund 的 14 days 对 30 days、warranty 的 1-year 对 90 days 不一致。local 因 eval failed 返回失败状态不应判 N。缺任一项判 N。",
        { on: JSON.stringify(turn1.toolCalls) },
      )
      .points(3)
      .gate();
    turn1.judge.autoevals
      .closedQA(
        "只判断助手回复。诊断必须准确报告 3 passed、2 failed、0 errored，并正确区分两个责任层：refund 是业务实现返回 14 days，而文档与 eval 要求 30 days，所以应修实现；warranty 的实现与文档都是 1-year，但 eval 错误期待 90 days，所以应修 eval。还应明确本轮没有修改文件。全部满足才判 Y。",
        { on: turn1.message },
      )
      .points(4)
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("诊断轮没有提前修改项目"))
      .points(1)
      .gate();
    turn1.succeeded().points(1).gate();

    const candidateVersion = String(t.flags.candidateVersion);
    const fullRerunRule = candidateVersion.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：业务源码不进入 eval fingerprint，工具调用证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行）；只让 warranty 因 eval 指纹变化重跑、同时携入旧 refund failure，不算完成。";
    const turn2 = await t.send("按你判断的责任层分别修好，再全量确认。");

    turn2
      .calledTool("shell", {
        input: { command: NICEEVAL_LOCAL_COMMAND },
        status: "completed",
      })
      .points(1)
      .gate();
    // TODO(niceeval): 等待 eventOrder 支持带数据的 event group matcher。
    turn2.eventOrder([
      {
        type: "tool",
        name: "shell",
        input: { command: NICEEVAL_LOCAL_COMMAND },
        status: "completed",
      },
      { type: "message", role: "assistant" },
    ]).points(1).gate();
    turn2.judge.autoevals
      .closedQA(
        `只判断本轮有序工具调用。必须确认助手先分别修改 refund 业务实现与 warranty eval，随后运行完整 niceeval exp local。${fullRerunRule} 缺任一项判 N。`,
        { on: JSON.stringify(turn2.toolCalls) },
      )
      .points(2)
      .gate();
    turn2.judge.autoevals
      .closedQA(
        "只判断本轮 NiceEval 工具输出。必须由真实输出支持最终 5 passed、0 failed、0 errored。缺任一项判 N。",
        { on: JSON.stringify(turn2.toolCalls) },
      )
      .points(3)
      .gate();
    turn2.judge.autoevals
      .closedQA(
        "只判断助手回复。必须明确说明把 refund 的业务实现恢复为 30 days，并把过期 warranty eval 的期望恢复为文档规定的 1-year，而不是放宽断言；准确汇报最终 5 passed、0 failed、0 errored。缺任一项判 N。",
        { on: turn2.message },
      )
      .points(3)
      .gate();

    const actualSource = await t.sandbox.readText("src/policies.ts");
    const actualWarrantyEval = await t.sandbox.readText("evals/policy/warranty.eval.ts");
    t.sandbox.fileChanged("src/policies.ts").points(1);
    t.sandbox.fileChanged("evals/policy/warranty.eval.ts").points(1);
    t.check(actualSource, includes(EXPECTED_REFUND_ANSWER)).points(1).gate();
    t.check(actualSource, excludes(INITIAL_REFUND_ANSWER)).points(1).gate();
    t.check(actualWarrantyEval, includes('includes("1-year")')).points(1).gate();
    t.check(actualWarrantyEval, excludes("90 days")).points(1).gate();

    const policyBehaviorTest = await t.sandbox.runCommand("node", [
      "--input-type=module",
      "-e",
      [
        'const { answerPolicyQuestion } = await import("./src/policy.ts");',
        "const cases = [",
        '  ["Can I return this for a refund?", "Customers may request a refund within 30 days of purchase."],',
        '  ["Can I exchange this?", "You may exchange an item within 14 days of delivery."],',
        '  ["When will delivery arrive?", "Orders ship within 2 business days and arrive within 5 business days."],',
        '  ["What warranty is included?", "Products are covered by a 1-year limited warranty."],',
        '  ["Do you sell my personal data?", "We do not sell your personal data."],',
        "];",
        "for (const [question, expected] of cases) {",
        "  const actual = answerPolicyQuestion(question);",
        "  if (actual !== expected) throw new Error(`${question}: ${actual}`);",
        "}",
      ].join("\n"),
    ]);
    t.check(policyBehaviorTest, commandSucceeded()).points(3).gate();
    turn2.succeeded().points(1).gate();
  },
});
