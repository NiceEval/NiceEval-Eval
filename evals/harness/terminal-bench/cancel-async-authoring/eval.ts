import { defineScoreEval, defineSimulatedUser } from "niceeval";
import { commandSucceeded, defineAgentJudge, equals } from "niceeval/expect";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { pullInnerNodeImage, pullInnerPythonImage } from "../../../../lib/sandbox.ts";

import { readFileSync } from "node:fs";
import { currentVerdicts, query, runOnce, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const TARGET_EVAL = "evals/terminal-bench/cancel-async-tasks.eval.ts";
const OFFICIAL_TESTS = "task/tests/test_outputs.py";
const FIXTURE = new URL("../../../../fixtures/harness/terminal-bench/cancel-async-authoring/repo/", import.meta.url);

// 官方题包：题面、Dockerfile、runner、参考答案与两份测试。
const originalOfficialTests = readFileSync(new URL(OFFICIAL_TESTS, FIXTURE), "utf8");

/** 评审者：读 agent 写出的 Eval，按 NiceEval 品味逐题打分。*/
const tasteReviewer = defineAgentJudge({
  concurrent: true,
  instructions: "你在评审被测 agent 刚写的 NiceEval Eval 源码写得好不好。自己阅读文件取证，只根据亲眼看到的内容评分。",
});

export default defineScoreEval({
  description: "把真实 Terminal-Bench 题包接成不泄漏判据、带正反控制的正式 Eval",
  tags: ["harness", "harness-v2", "terminal-bench", "authoring", "hidden-tests", "deterministic", "single-turn"],
  timeoutMs: 30 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(pullInnerNodeImage).before(pullInnerPythonImage).before(uploadDirectory({
    id: "fixture",
    source: FIXTURE,
    to: ".",
  })),
  async test(t) {
    // 真实用户只说要什么；隐藏判据、指纹和不改题包，都应由随包文档和 agent 的判断补上。
    const input = `把 task/ 这道 Terminal-Bench 题写成 ${TARGET_EVAL}，用官方 tests 判分。写好后用 oracle 和 leak-probe 各跑一次，告诉我结果。`;
    let turn = await t.send(input);
    const simulatedUser = t.simulatedUser(defineSimulatedUser({
      instructions: "你是提出以下任务的用户，只依据原请求回答 agent 的提问，不补充未提供的事实、不扩大修改与付费运行授权；未决定的实现细节让 agent 依据仓库、公开结果与随包文档自行判断。原请求：" + input,
    }));
    let answered = 0;
    while (turn.status === "waiting" && answered < 6) {
      turn = await simulatedUser.reply(turn);
      answered++;
    }
    t.note("HITL 回答次数", { answered, firstReplyWasHITL: answered > 0, stillWaiting: turn.status === "waiting" });
    const shell: Shell = (script) => t.sandbox.runShell(script);
    // 先读 agent 自己跑出的结果，外层探针运行之后这些结果会被覆盖。
    const student = {
      oracle: currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "oracle" })),
      "leak-probe": currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "leak-probe" })),
    };
    t.log(JSON.stringify({ rubric: "harness-v2", student }));
    t.check(student, equals({
      oracle: { "terminal-bench/cancel-async-tasks": "passed" },
      "leak-probe": { "terminal-bench/cancel-async-tasks": "failed" },
    })).label("Agent 自己完成正反运行（外层验收不补此事实）");

    turn.succeeded()
      .label("Eval authoring Turn 成功");

    // agent 写出的 Eval 有没有 NiceEval 品味：评审自己去读它写的文件。
    await t.group("NiceEval 品味", () => {
      const taste = t.agentJudge(tasteReviewer, { evalFile: TARGET_EVAL });
      taste.chat("evalFile 是 agent 写的正式 Eval，先读完这些文件。");
      taste.judge(
        "只读 agent 写的 Eval 正文就能说出它测什么、什么算通过、分数或门槛怎么来；" +
        "交给官方测试判定的部分，正文直接写明执行哪份官方测试、按什么门槛（退出码、通过数量）算通过，" +
        "官方测试内部各项测什么不要求在正文里重复。" +
        "关键阈值、数量和分值直接写在检查上，没有藏进辅助函数，也没有先装进数组再用循环登记。")
        .score(1).label("判据平铺在打分处");
      taste.judge(
        "能直接读到的事实（工具名与参数、次数、文件内容、命令退出码、结构化字段）用确定性检查，" +
        "没有把这类事实交给 Judge 判断。")
        .score(1).label("事实用确定性检查");
      taste.judge(
        "能用现成 Match（equals、includes、pattern、toolMatch、countWhere、referencesAnyPath 等）表达的判据，" +
        "没有先手算成布尔值或计数，再交给 isTrue 或 equals(true)。")
        .score(1).label("判据写在 Match 上");
      taste.judge(
        "缺失的数据（缺记录、解析失败、读不到文件）保留为不可判定或直接报错，没有补成 0、false 或空字符串后继续判分。")
        .score(1).label("未知保持未知");
    });
    t.notCalledTool(
      readsPrivateRecord,
    )
      .label("未读取 .niceeval 私有结果");

    t.sandbox.changedPaths([TARGET_EVAL])
      .score(1)
      .label("只创建目标 Eval");

    t.sandbox.unchangedWithin(["task"])
      .score(2)
      .label("官方题面、判据与参考答案保持原样");

    const dry = await t.sandbox.runCommand(
      "pnpm",
      ["exec", "niceeval", "exp", "oracle", "--dry"],
    );
    t.check(dry, commandSucceeded())
      .score(2)
      .label("目标 Eval 可发现并可完成 link plan");

    const expectPassed = { "terminal-bench/cancel-async-tasks": "passed" };
    const expectFailed = { "terminal-bench/cancel-async-tasks": "failed" };
    const oracle = await runOnce(shell, ["oracle", "--rerun", "all"]);
    t.log(JSON.stringify({ outerProbe: "oracle", ...oracle }));
    t.check({ exitCode: oracle.exitCode, results: oracle.results }, equals({ exitCode: 0, results: expectPassed }))
      .score(6)
      .label("官方参考实现通过完整官方判据");

    try {
      await t.sandbox.writeText(OFFICIAL_TESTS,
        `${originalOfficialTests}\n# Harness fingerprint probe: behavior intentionally unchanged.\n`);
      // No rerun flag: this specifically tests criteria invalidation.
      const fingerprint = await runOnce(shell, ["oracle"]);
      t.log(JSON.stringify({ outerProbe: "fingerprint", ...fingerprint }));
      // Score invalidation separately: a fresh attempt that times out still proves
      // the old result was not reused. Keep its completion status visible below.
      t.check(fingerprint.actions, equals(["executed"]))
        .score(2)
        .label("隐藏判据变化会自动作废旧结果");
      t.check({ exitCode: fingerprint.exitCode, results: fingerprint.results }, equals({ exitCode: 0, results: expectPassed }))
        .label("无行为变化的判据探针运行完成且参考实现仍通过");

      const leak = await runOnce(shell, ["leak-probe", "--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "leak-probe", ...leak }));
      t.check({ exitCode: leak.exitCode, results: leak.results }, equals({ exitCode: 1, results: expectFailed }))
        .score(3)
        .label("未见隐藏材料的负向探针保持 ordinary failed");

      // Independent mutation catches skipped tests and ignored verifier exit codes.
      await t.sandbox.writeText(OFFICIAL_TESTS,
        `${originalOfficialTests}\n\ndef test_harness_verifier_must_execute():\n    assert False, "outer harness verifier sentinel"\n`);
      const sentinel = await runOnce(shell, ["oracle", "--rerun", "all"]);
      t.log(JSON.stringify({ outerProbe: "verifier-sentinel", ...sentinel }));
      t.check({ exitCode: sentinel.exitCode, results: sentinel.results }, equals({ exitCode: 1, results: expectFailed }))
        .score(2)
        .label("真实测试新增失败会使 oracle ordinary failed，而非忽略退出码");
    } finally {
      await t.sandbox.writeText(OFFICIAL_TESTS, originalOfficialTests);
    }
  },
});
