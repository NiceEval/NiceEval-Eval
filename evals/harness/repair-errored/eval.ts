import { defineEval } from "niceeval";
import { excludes, includes, isTrue } from "niceeval/expect";
import { assertCandidateHasAnyPage } from "../../../lib/candidate.ts";

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/agent-feedback-loop.mdx",
  "docs-site/zh/tutorials/agent-feedback-loop.mdx",
  "docs-site/zh/troubleshooting/debugging.mdx",
] as const;

const WORKING_ENDPOINT = "memory://policy";
const BROKEN_ENDPOINT = "http://policy.invalid:8787";

export default defineEval({
  description: "两轮诊断五个执行错误，只修配置并重跑到全绿",
  tags: ["harness", "repair", "errored", "multi-turn"],
  timeoutMs: 20 * 60 * 1000,
  async test(t) {
    assertCandidateHasAnyPage(EXPECTED_PAGES, t.flags.candidateVersion as string);

    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/repair-errored/repo/", import.meta.url),
    );
    const startingConfig = await t.sandbox.readText("config/policy.json");
    if (!startingConfig.includes(BROKEN_ENDPOINT)) {
      throw new Error("repair-errored repo 缺少预期的不可达 endpoint 起始配置");
    }

    const diagnosis = await t.send("先看看 local experiment 为什么跑不起来，暂时别改。");

    diagnosis.judge.autoevals
      .closedQA(
        "只判断这一轮诊断回复，以下条件必须同时满足：准确报告 local 共 5 个 eval、0 passed、0 failed、5 errored，并明确它们是执行错误而非断言失败；根据实际证据指出连接 http://policy.invalid:8787 时 ECONNREFUSED；把根因定位到 config/policy.json 的 endpoint，而不是业务答案、eval 或断言；没有声称已经修改文件。漏掉任一项或混淆 failed 与 errored 都判 N。",
      )
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("第一轮只诊断，没有提前修改项目"));
    diagnosis.succeeded();

    const repair = await t.send("把它修好，再确认一下。");

    repair.judge.autoevals
      .closedQA(
        "只判断这一轮修复回复，以下条件必须同时满足：明确说明只把 config/policy.json 的 endpoint 恢复为 memory://policy，没有修改业务实现、eval、断言或 experiment；明确说明修复后重新运行并核对 local experiment；准确汇报最终共 5 个 eval、5 passed、0 failed、0 errored。泛称已恢复或漏掉任一项都判 N。",
      )
      .gate();

    const repairedConfig = await t.sandbox.readText("config/policy.json");
    t.sandbox.fileChanged("config/policy.json");
    t.check(repairedConfig, includes(WORKING_ENDPOINT));
    t.check(repairedConfig, excludes(BROKEN_ENDPOINT));
    repair.succeeded();
  },
});
