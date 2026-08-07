import { defineEval } from "niceeval";
import { excludes, includes, isTrue } from "niceeval/expect";

const REFUND_CORRECT = "Customers may request a refund within 30 days of purchase.";
const REFUND_BROKEN = "Customers may request a refund within 14 days of purchase.";
const WARRANTY_CORRECT = "Products are covered by a 1-year limited warranty.";
const WARRANTY_BROKEN = "Products are covered by a 90-day limited warranty.";

export default defineEval({
  description: "两轮诊断两个断言失败，只修业务实现并重跑五道题到全绿",
  tags: ["harness", "repair", "failed", "multi-turn"],
  timeoutMs: 20 * 60 * 1000,
  async test(t) {
    // 候选镜像只带共享依赖；把本题自己的起始 repo 铺进当前 attempt 的 workspace 根目录。
    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/repair-failing/repo/", import.meta.url),
      ".",
    );
    const startingSource = await t.sandbox.readText("src/policies.ts");
    if (!startingSource.includes(REFUND_BROKEN) || !startingSource.includes(WARRANTY_BROKEN)) {
      throw new Error("repair-failing repo 缺少预期的 refund / warranty 起始缺陷");
    }

    const diagnosis = await t.send("先看看 local experiment 为什么失败，暂时别改。");

    diagnosis.judge.autoevals
      .closedQA(
        "只判断这一轮诊断回复，以下条件必须同时满足：准确报告 local 共 5 个 eval、3 passed、2 failed、0 errored；明确失败的是 policy/refund 与 policy/warranty（允许带目录或后缀）；根据实际失败证据指出退款 14 days 对 30 days、保修 90-day 对 1-year 两个独立不一致；把根因定位到 src/policies.ts；没有声称已经修改文件。漏掉任一项或把 failed 说成 errored 都判 N。",
      )
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("第一轮只诊断，没有提前修改项目"));
    diagnosis.succeeded();

    const repair = await t.send("把它修好，再确认一下。");

    repair.judge.autoevals
      .closedQA(
        "只判断这一轮修复回复，以下条件必须同时满足：明确说明只修复 src/policies.ts 中退款与保修两条业务实现，恢复 30-day refund 与 1-year warranty，而没有靠修改 eval、断言或 experiment 制造绿色；明确说明修复后重新运行并核对 local experiment；准确汇报最终共 5 个 eval、5 passed、0 failed、0 errored。泛称已修好或漏掉任一项都判 N。",
      )
      .gate();

    const repairedSource = await t.sandbox.readText("src/policies.ts");
    t.sandbox.fileChanged("src/policies.ts");
    t.check(repairedSource, includes(REFUND_CORRECT));
    t.check(repairedSource, includes(WARRANTY_CORRECT));
    t.check(repairedSource, excludes(REFUND_BROKEN));
    t.check(repairedSource, excludes(WARRANTY_BROKEN));
    repair.succeeded();
  },
});
