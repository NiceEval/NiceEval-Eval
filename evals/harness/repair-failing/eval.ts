import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, excludes, includes, isTrue } from "niceeval/expect";
import { listWorkspaceFiles, readFiles, turnEvidence } from "../support.ts";

const REFUND_CORRECT = "Customers may request a refund within 30 days of purchase.";
const REFUND_BROKEN = "Customers may request a refund within 14 days of purchase.";

const MUTABLE_FILES: ReadonlySet<string> = new Set([
  "src/policies.ts",
  "evals/policy/warranty.eval.ts",
]);

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
    const startingFiles = await listWorkspaceFiles(t.sandbox);
    const immutableFiles = startingFiles.filter((file) => !MUTABLE_FILES.has(file));

    const version = String(t.flags.candidateVersion);
    const startingSource = await t.sandbox.readText("src/policies.ts");
    const startingWarrantyEval = await t.sandbox.readText("evals/policy/warranty.eval.ts");
    if (
      !startingSource.includes(REFUND_BROKEN) ||
      !startingSource.includes("1-year limited warranty") ||
      !startingWarrantyEval.includes('includes("90 days")')
    ) {
      throw new Error("repair-failing repo 缺少预期的双层起始缺陷");
    }
    const immutableBefore = await readFiles(t.sandbox, immutableFiles);

    const diagnosisCommandStart = t.o11y.shellCommands.length;
    const diagnosis = await t.send("先调查 local experiment 的失败，判断每一处到底该改哪一层；暂时别改。");
    const diagnosisEvidence = turnEvidence(
      version,
      diagnosis.message,
      t.o11y.shellCommands.slice(diagnosisCommandStart),
    );

    diagnosis.judge.autoevals
      .closedQA(
        "输入是一份宿主侧证据 JSON，包含本轮助手原始回复和本轮真实 shell 命令。命令证据必须显示助手确实运行了非 dry-run 的 local experiment，并使用 NiceEval 的结果查看能力下钻失败证据；回复必须准确报告共 5 个 eval、3 passed、2 failed、0 errored，并点名 policy/refund 与 policy/warranty。exp 因 eval failed 返回退出码 1 是预期现象。只读源码后猜测、没有实际运行或漏掉任一计数都判 N。",
        { on: diagnosisEvidence },
      )
      .points(3)
      .gate();
    diagnosis.judge.autoevals
      .closedQA(
        "输入是一份宿主侧证据 JSON。诊断必须基于实际失败证据和 docs/policies.md 的业务真值，正确区分两个不同责任层：refund 是 src/policies.ts 仍返回 14 days，而文档与 eval 都要求 30 days，所以应修业务实现；warranty 的业务实现与文档都是 1-year，但 eval 错误期待 90 days，所以应修 eval。还应明确本轮没有修改文件，不能笼统地把两处都归咎于业务代码或都归咎于测试。全部满足才判 Y。",
        { on: diagnosisEvidence },
      )
      .points(4)
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("诊断轮没有提前修改项目"))
      .points(1)
      .gate();
    diagnosis.succeeded().points(1).gate();

    const fullRerunRule = version.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：业务源码不进入 eval fingerprint，命令证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行）；只让 warranty 因 eval 指纹变化重跑、同时携入旧 refund failure，不算完成。";
    const repairCommandStart = t.o11y.shellCommands.length;
    const repair = await t.send("按你判断的责任层分别修好，再全量确认。");
    const repairEvidence = turnEvidence(
      version,
      repair.message,
      t.o11y.shellCommands.slice(repairCommandStart),
    );

    repair.judge.autoevals
      .closedQA(
        `输入是一份宿主侧证据 JSON。必须同时满足：回复明确说明把 refund 的业务实现恢复为 30 days，并把过期 warranty eval 的期望恢复为文档规定的 1-year，而不是放宽断言；命令证据显示修改后真实执行了完整 local experiment 且最终命令成功；准确汇报最终 5 passed、0 failed、0 errored。${fullRerunRule} 缺任一项判 N。`,
        { on: repairEvidence },
      )
      .points(4)
      .gate();

    const repairedSource = await t.sandbox.readText("src/policies.ts");
    const repairedWarrantyEval = await t.sandbox.readText("evals/policy/warranty.eval.ts");
    t.sandbox.fileChanged("src/policies.ts").points(1);
    t.sandbox.fileChanged("evals/policy/warranty.eval.ts").points(1);
    t.check(repairedSource, includes(REFUND_CORRECT)).points(1).gate();
    t.check(repairedSource, excludes(REFUND_BROKEN)).points(1).gate();
    t.check(repairedWarrantyEval, includes('includes("1-year")')).points(1).gate();
    t.check(repairedWarrantyEval, excludes("90 days")).points(1).gate();

    const immutableAfter = await readFiles(t.sandbox, immutableFiles);
    t.check(
      immutableAfter.every((content, index) => content === immutableBefore[index]),
      isTrue("除 refund 业务实现与 warranty eval 外，其余 agent、配置、文档、eval 和 experiment 均未改动"),
    )
      .points(2)
      .gate();
    const finalFiles = await listWorkspaceFiles(t.sandbox);
    t.check(finalFiles, equals(startingFiles)).points(2).gate();

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
