import { defineScoreEval } from "niceeval";
import { commandSucceeded, excludes, includes, isTrue } from "niceeval/expect";

const REFUND_CORRECT = "Customers may request a refund within 30 days of purchase.";
const REFUND_BROKEN = "Customers may request a refund within 14 days of purchase.";

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

    const diagnosis = await t.send("先调查 local experiment 的失败，判断每一处到底该改哪一层；暂时别改。");

    diagnosis.calledTool("shell", { status: "completed" }).points(1).gate();
    diagnosis.judge.autoevals
      .closedQA(
        "输入是本轮标准工具调用 JSON。必须能从真实调用的入参、输出和状态确认：助手运行了非 dry-run 的 local experiment；实际结果为 5 个 eval、3 passed、2 failed、0 errored，失败是 policy/refund 与 policy/warranty；随后使用 NiceEval 的结果查看能力下钻了失败证据。local 因 eval failed 返回失败状态不应判 N。缺任一项判 N。",
        { on: JSON.stringify(diagnosis.toolCalls) },
      )
      .points(3)
      .gate();
    diagnosis.judge.autoevals
      .closedQA(
        "只判断助手回复。诊断必须准确报告 3 passed、2 failed、0 errored，并正确区分两个责任层：refund 是业务实现返回 14 days，而文档与 eval 要求 30 days，所以应修实现；warranty 的实现与文档都是 1-year，但 eval 错误期待 90 days，所以应修 eval。还应明确本轮没有修改文件。全部满足才判 Y。",
        { on: diagnosis.message },
      )
      .points(4)
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("诊断轮没有提前修改项目"))
      .points(1)
      .gate();
    diagnosis.succeeded().points(1).gate();

    const version = String(t.flags.candidateVersion);
    const fullRerunRule = version.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：业务源码不进入 eval fingerprint，工具调用证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行）；只让 warranty 因 eval 指纹变化重跑、同时携入旧 refund failure，不算完成。";
    const repair = await t.send("按你判断的责任层分别修好，再全量确认。");

    repair.calledTool("shell", { status: "completed" }).points(1).gate();
    repair.judge.autoevals
      .closedQA(
        `输入是本轮标准工具调用 JSON。必须能从真实调用的入参、输出和状态确认：修改后执行了完整 local experiment，并实际得到 5 passed、0 failed、0 errored。${fullRerunRule} 缺任一项判 N。`,
        { on: JSON.stringify(repair.toolCalls) },
      )
      .points(3)
      .gate();
    repair.judge.autoevals
      .closedQA(
        "只判断助手回复。必须明确说明把 refund 的业务实现恢复为 30 days，并把过期 warranty eval 的期望恢复为文档规定的 1-year，而不是放宽断言；准确汇报最终 5 passed、0 failed、0 errored。缺任一项判 N。",
        { on: repair.message },
      )
      .points(3)
      .gate();

    const repairedSource = await t.sandbox.readText("src/policies.ts");
    const repairedWarrantyEval = await t.sandbox.readText("evals/policy/warranty.eval.ts");
    t.sandbox.fileChanged("src/policies.ts").points(1);
    t.sandbox.fileChanged("evals/policy/warranty.eval.ts").points(1);
    t.check(repairedSource, includes(REFUND_CORRECT)).points(1).gate();
    t.check(repairedSource, excludes(REFUND_BROKEN)).points(1).gate();
    t.check(repairedWarrantyEval, includes('includes("1-year")')).points(1).gate();
    t.check(repairedWarrantyEval, excludes("90 days")).points(1).gate();

    const probe = await t.sandbox.runCommand("node", [
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
    t.check(probe, commandSucceeded()).points(3).gate();
    repair.succeeded().points(1).gate();
  },
});
