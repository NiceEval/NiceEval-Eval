import { defineScoreEval } from "niceeval";
import { includes, referencesAnyPath, toolMatch } from "niceeval/expect";

export default defineScoreEval({
  description: "修复 Terminal-Bench task slice 的局部 runtime 缺失，并保留可信结果",
  tags: ["harness", "terminal-bench", "infrastructure", "cache", "single-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  judge: true,
  async test(t) {
    await t.sandbox.uploadDirectory(
      new URL("../../../../fixtures/harness/terminal-bench/regex-log/repo/", import.meta.url),
      ".",
    );

    const candidateVersion = String(t.flags.candidateVersion);
    // 题面刻意不预告 error 或根因：测的就是 agent 能否把 errored
    // 识别为“还没跑完”，自主修复基础设施后复验，同时保留已完成的合法 failed。
    const turn = await t.send("把这次评估跑完，告诉我最终结果。");

    turn.notCalledTool(
      toolMatch({ input: referencesAnyPath([".niceeval", "evals", "agents"]) }),
    ).key("harness.regex-log.public-evidence.verdict").gate();
    turn.succeeded().key("harness.regex-log.turn-succeeded.verdict").gate();

    t.sandbox.changedPaths(["experiments/local.ts"])
      .key("harness.regex-log.changed-only-config.verdict")
      .gate();
    t.sandbox.changedPaths(["experiments/local.ts"])
      .key("harness.regex-log.changed-only-config.score")
      .label("修改范围")
      .score(3);

    t.sandbox.fileChanged("experiments/local.ts", {
      before: includes("runtime:node"),
      after: includes("runtime:python"),
    }).key("harness.regex-log.runtime-repaired.verdict").gate();
    t.sandbox.fileChanged("experiments/local.ts", {
      before: includes("runtime:node"),
      after: includes("runtime:python"),
    })
      .key("harness.regex-log.runtime-repaired.score")
      .label("runtime 配置修复")
      .score(2);

    const turnMaterial = {
      input: "把这次评估跑完，告诉我最终结果。",
      output: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    };

    t.judge.autoevals.closedQA("【最终 current 结果】只依据本轮完整有序 Turn 的公开输出判断：Agent 必须先真实运行非 dry-run local experiment、经 show 诊断后才修复，并在修复后再次真实运行再用最后一次 niceeval show 核对 current leaderboard。该最后公开输出必须恰好是 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug、terminal-bench/regex-log 四项，其中 3 passed、1 failed、0 errored；唯一 failed 是原本就合法的 terminal-bench/classifier-debug，不能用回复中的自报数字代替 CLI 证据，最终回复也必须在这次复验 show 之后说明结论。", turnMaterial)
      .score(3)
      .atLeast(1)
      .gate();

    t.judge.autoevals.closedQA(candidateVersion.startsWith("0.9.") ? "【公开 history 正确】候选是 0.9.x：只依据本轮完整有序 Turn 中先运行、再公开 show、修复、复验、再 show 的证据判断。该版本没有 locator accept；runtime 修复后必须看到四项都产生新的真实 terminal result，最终 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/regex-log passed，terminal-bench/classifier-debug 保持原本合法的 failed，不能用回复自报或私有文件补证据。" : "【公开 history 正确】候选是 0.12+ 或 canary：综合本轮完整有序 Turn 中先运行后取得的公开 dry/show 输出、动态 locator、accept 回执与复验计划判断。terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug 恰好三个仍有效 terminal results 被 accept，原 verdict 依次为 passed、passed、failed；接受前公开的不兼容原因只能是 config:sandboxLayer 与 plan:physical。terminal-bench/regex-log 必须保留一次真实 errored 记录并再真实执行为 passed，复验计划应是 3 carried、1 to run；不能 accept 第四项，也不能强求公开界面没有展示的私有字段或 literal image tag。", turnMaterial)
      .score(6)
      .atLeast(1)
      .gate();

    t.judge.autoevals.closedQA(candidateVersion.startsWith("0.9.") ? "【根因、范围与版本策略】完整有序 Turn 必须依次证明 Agent 先真实运行非 dry-run local experiment，再从 compact show 取得 errored terminal-bench/regex-log 的动态 locator，并让后续 --eval 与 --execution 在该 show 输出之后使用同一个 locator；公开输出必须证明根因是 runtime 缺少 Python，Agent 只修改基础设施配置。由于 0.9.x 没有 locator accept，改 runtime 后完整重跑四项，并保留 terminal-bench/classifier-debug 原本合法的 failed；最终回复必须在复验输出之后说明这些依据。" : "【根因、范围与版本策略】完整有序 Turn 必须依次证明 Agent 先真实运行非 dry-run local experiment，再从 compact show 取得 errored terminal-bench/regex-log 的动态 locator，并让后续 --source 与 --execution 在该 show 输出之后使用同一个 locator；公开输出必须证明根因是 runtime 缺少 Python，Agent 只修改基础设施配置。对 0.12+ 或 canary 应从 show 证据 accept 恰好三个仍有效 terminal results，只真实重跑 errored 的 terminal-bench/regex-log，并保留 terminal-bench/classifier-debug 原本合法的 failed；强制 --rerun all 或重跑全部四项判为错误，最终回复必须在复验输出之后说明这些依据。", turnMaterial)
      .score(4)
      .atLeast(1)
      .gate();
  },
});
