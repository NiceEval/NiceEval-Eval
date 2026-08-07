import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";
import { assertCandidateHasAnyPage } from "../../../lib/candidate.ts";

const EXPECTED_PAGES = [
  "docs-site/zh/how-to/agent-feedback-loop.mdx",
  "docs-site/zh/how-to/viewing-results.mdx",
  "docs-site/zh/how-to/write-experiment.mdx",
  "docs-site/zh/tutorials/agent-feedback-loop.mdx",
  "docs-site/zh/tutorials/viewing-results.mdx",
  "docs-site/zh/tutorials/write-experiment.mdx",
] as const;

export default defineEval({
  description: "自行运行并准确汇报一个包含五道题的绿色 experiment",
  tags: ["harness", "run"],
  timeoutMs: 15 * 60 * 1000,
  async test(t) {
    assertCandidateHasAnyPage(EXPECTED_PAGES, t.flags.candidateVersion as string);
    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/run-existing/repo/", import.meta.url),
    );

    const result = await t.send("帮我跑一下 local experiment，看看结果。");

    result.judge.autoevals
      .closedQA(
        "只判断这一轮助手回复，以下条件必须同时满足：明确表示实际运行并核对了 local experiment；准确汇报共 5 个 eval，5 passed、0 failed、0 errored；结论来自 NiceEval 的实际结果而非仅凭 shell 退出码猜测；没有声称修改了代码或配置。同义的中英文表达可以；泛称全绿或漏掉任一事实都判 N。",
      )
      .gate();

    t.check(t.sandbox.diff.isEmpty(), isTrue("agent 没有修改已经全绿的项目"));
    result.succeeded();
  },
});
