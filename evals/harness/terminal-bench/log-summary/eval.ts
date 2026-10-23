import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals, referencesAnyPath, toolMatch } from "niceeval/expect";
import { changeFrequency, sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { loadCriteria } from "niceeval/loaders";
import { yesNo } from "../../../../lib/judge.ts";
import { exp, query } from "../../../../lib/query.ts";

await loadCriteria({ pattern: "../../../../fixtures/harness/terminal-bench/log-summary/repo/**/*", relativeTo: new URL(import.meta.url) });

const GIB = 1024 ** 3;

export default defineScoreEval({
  description: "只凭公开结果区分 Terminal-Bench agent 产出错误与过紧 eval",
  tags: ["harness", "harness-v2", "terminal-bench", "diagnosis", "failed", "single-turn"],
  timeoutMs: 20 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
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
    // 先由 fixture 跑完 experiment，再让 agent 接手已经停稳的 Record。
    const shell = (script: string) => t.sandbox.runShell(script);
    const initial = await exp(shell, ["local"]);
    const local = await query(shell, { kind: "experiment.get", experimentId: "local" });
    const initialResults = Object.fromEntries(
      (local?.experiment.cells ?? []).map((c: { evalId: string; members: { publication?: { verdict?: string } }[] }) =>
        [c.evalId, c.members[0]?.publication?.verdict ?? null]),
    );
    const expected = {
      "terminal-bench/classifier-debug": "failed",
      "terminal-bench/hello-world": "passed",
      "terminal-bench/log-summary": "failed",
    };
    if (initial.exitCode !== 1 || !isDeepStrictEqual(initialResults, expected)) {
      throw new Error(`log-summary fixture 未形成 1 passed / 2 failed 初始结果（实际：${JSON.stringify(initialResults)}），不能对 agent 判分`);
    }

    // 用户只要求归因，没有授权改文件；failed 是已完成的业务结论，不应重跑或“修绿”。
    const input = "刚才的 local 评估已经跑完了，定位一下为什么有两个失败。只分析已有结果，不修改项目、不重新运行评估。";
    const turn = await t.send(input);
    const runs = await query(shell, { kind: "run.list" });
    t.check(runs.runs.map((r: { runId: string }) => r.runId), equals(initial.runIds))
      .key("harness.log-summary.no-new-runs").label("只读任务没有新发布 Run");

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

    // 证据链看完整 Turn 历史（消息与工具调用）；事实与归因只看最终回复。
    const evidenceOptions = { maxMaterialBytes: 1024 * 1024, maxAuditBytes: 4 * 1024 * 1024 };
    const reply = { task: input, reply: turn.reply };

    // 每个失败各 7 分：公开证据链 2 分、最终任务事实 2 分、责任归因 3 分。
    // 两题都不能只凭复述 actual / expected mismatch 获得归因分；最终回复必须
    // 明确判断责任在错误的 agent 结果，还是在拒绝合法结果的过紧 Eval。
    turn.closeQA("【classifier-debug 公开证据】只判断完整有序 Turn 是否形成这条公开证据链：使用公开 niceeval show 或 query 的等价结果，固定本次 local Run 及 classifier-debug 的 Attempt，确认整体 1 passed、2 failed、0 errored，并从公开执行、源码或断言详情确认 agent 写入 B、正确答案与断言要求都是 A。", evidenceOptions)
      .score(2)
      .key("harness.log-summary.classifier-evidence")
      .label("classifier-debug 公开证据完整");

    t.judge(reply, yesNo("classifier-answer-fact", "【classifier-debug 最终任务事实】只判断最终回复是否明确说明 terminal-bench/classifier-debug 的 agent 实际选择或写入 B，而题目正确答案与 Eval 期望都是 A。只需判断事实是否说清，不在本项判断责任归因。"))
      .score(2)
      .key("harness.log-summary.classifier-answer-fact")
      .label("classifier-debug 最终事实正确");

    t.judge(reply, yesNo("classifier-agent-attribution", "【classifier-debug 最终责任归因】只判断最终回复是否把 terminal-bench/classifier-debug 的失败解释为：题目正确要求或有效判据是 A，而 agent/canned answer 选择了 B，因此 agent 结果没有满足题目。明确作出这条因果对比即满足，不要求额外使用‘agent 错误’等固定措辞。若回复质疑 A 是正确要求、把责任归为 Eval 对 A 的要求过紧，或没有把 B 与题目要求 A 连接起来，则不满足。"))
      .score(3)
      .key("harness.log-summary.classifier-agent-attribution")
      .label("classifier-debug 最终归因 agent 答案错误");

    turn.closeQA("【log-summary 公开证据】只判断完整有序 Turn 是否形成这条公开证据链：使用公开 niceeval show 或 query 固定本次 local Run 的 log-summary Attempt，再从公开执行、源码或断言详情确认 agent 生成四行合法 CSV，ERROR/WARNING/INFO 为 4/3/8，实际差异只是 CSV 字段带有允许的双引号，而 exact Assertion 要求无引号文本。", evidenceOptions)
      .score(2)
      .key("harness.log-summary.log-evidence")
      .label("log-summary 公开证据完整");

    t.judge(reply, yesNo("log-result-valid", "【log-summary 最终任务事实】只判断最终回复是否明确说明 terminal-bench/log-summary 的 ERROR/WARNING/INFO 计数为 4/3/8，且带双引号的四行产物仍是满足题面要求的合法 CSV，因此任务结果本身正确。只说‘输出带引号、与 exact 文本不同’而没有肯定其合法且满足题面，必须判为不满足。"))
      .score(2)
      .key("harness.log-summary.log-result-valid")
      .label("log-summary 最终确认任务结果正确");

    t.judge(reply, yesNo("log-eval-attribution", "【log-summary 最终责任归因】只判断最终回复是否明确得出 terminal-bench/log-summary 的失败责任在 Eval：它用过紧的精确字符串断言拒绝了题面允许的合法 CSV。若回复称这是 agent 输出错误，或只描述引号与 exact 文本的差异而没有把判据定性为过紧，必须判为不满足。可以说明 NiceEval runtime 本身没有问题，只要明确本地 Eval 的断言过紧。题面没有要求修复建议，是否附带建议不属于本项。"))
      .score(3)
      .key("harness.log-summary.log-eval-attribution")
      .label("log-summary 最终归因 Eval 过紧");
  },
});
