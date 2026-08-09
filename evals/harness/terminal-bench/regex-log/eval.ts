import { defineScoreEval } from "niceeval";
import { commandMatch, includes, referencesAnyPath, toolMatch } from "niceeval/expect";

export default defineScoreEval({
  description: "修复 Terminal-Bench task slice 的局部 runtime 缺失，并保留可信结果",
  tags: ["harness", "terminal-bench", "infrastructure", "cache", "single-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  async test(t) {
    await t.sandbox.uploadDirectory(
      new URL("../../../../fixtures/harness/terminal-bench/regex-log/repo/", import.meta.url),
      ".",
    );

    const candidateVersion = String(t.flags.candidateVersion);
    const turn = await t.send("把评估跑通一下");

    turn.toolOrder(
      [commandMatch("niceeval", { argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] }), commandMatch("niceeval", { argsStart: ["show"], status: "completed" }), commandMatch("niceeval", { argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] }), commandMatch("niceeval", { argsStart: ["show"], status: "completed" })],
    ).gate();
    turn.notCalledTool(toolMatch({ input: referencesAnyPath([".niceeval", "evals", "agents"]) })).gate();
    turn.succeeded().gate();
    t.sandbox.changedPaths(["experiments/local.ts"]).points(3).gate();
    t.sandbox.fileChanged("experiments/local.ts", { before: includes("runtime:node"), after: includes("runtime:python") }).points(2).gate();

    turn.judge.autoevals.closedQA("【最终 current 结果】只依据本轮最后一次 niceeval show 的公开输出判断：current leaderboard 必须恰好是 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug、terminal-bench/regex-log 四项，其中 3 passed、1 failed、0 errored；唯一 failed 是原本就合法的 terminal-bench/classifier-debug，不能用回复中的自报数字代替 CLI 证据。", {
      on: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    }).points(3).gate();

    turn.judge.autoevals.closedQA(candidateVersion.startsWith("0.9.") ? "【公开 history 正确】候选是 0.9.x：只依据本轮完整有序 Turn 中的公开 show 输出判断。该版本没有 locator accept；runtime 修复后必须看到四项都产生新的真实 terminal result，最终 terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/regex-log passed，terminal-bench/classifier-debug 保持原本合法的 failed，不能用回复自报或私有文件补证据。" : "【公开 history 正确】候选是 0.12+ 或 canary：综合本轮公开 dry/show 输出、accept 回执与复验计划判断。terminal-bench/hello-world、terminal-bench/fix-permissions、terminal-bench/classifier-debug 恰好三个仍有效 terminal results 被 accept，原 verdict 依次为 passed、passed、failed；接受前公开的不兼容原因只能是 config:sandboxLayer 与 plan:physical。terminal-bench/regex-log 必须保留一次真实 errored 记录并再真实执行为 passed，复验计划应是 3 carried、1 to run；不能 accept 第四项，也不能强求公开界面没有展示的私有字段或 literal image tag。", {
      on: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    }).points(6).gate();

    turn.judge.autoevals.closedQA(candidateVersion.startsWith("0.9.") ? "【根因、范围与版本策略】完整有序 Turn 必须证明 Agent 先从 compact show 取得 errored terminal-bench/regex-log 的动态 locator，并让后续 --eval 与 --execution 使用同一个 locator；公开输出必须证明根因是 runtime 缺少 Python，Agent 只修改基础设施配置。由于 0.9.x 没有 locator accept，改 runtime 后完整重跑四项，并保留 terminal-bench/classifier-debug 原本合法的 failed；最终回复必须在复验输出之后说明这些依据。" : "【根因、范围与版本策略】完整有序 Turn 必须证明 Agent 先从 compact show 取得 errored terminal-bench/regex-log 的动态 locator，并让后续 --source 与 --execution 使用同一个 locator；公开输出必须证明根因是 runtime 缺少 Python，Agent 只修改基础设施配置。对 0.12+ 或 canary 应从 show 证据 accept 恰好三个仍有效 terminal results，只真实重跑 errored 的 terminal-bench/regex-log，并保留 terminal-bench/classifier-debug 原本合法的 failed；强制 --rerun all 或重跑全部四项判为错误，最终回复必须在复验输出之后说明这些依据。", {
      on: JSON.stringify({ toolCalls: turn.toolCalls, message: turn.message }),
    }).points(4).gate();
  },
});
