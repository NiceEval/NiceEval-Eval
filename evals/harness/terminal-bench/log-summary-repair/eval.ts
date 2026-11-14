import { isDeepStrictEqual } from "node:util";
import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";
import { loadText } from "niceeval/loaders";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";
import { pullInnerNodeImage } from "../../../../lib/sandbox.ts";

import { changedFixtureFiles, loadFixtureFiles } from "../../../../lib/fixture-files.ts";
import { yesNo } from "../../../../lib/judge.ts";
import { currentVerdicts, exp, query, runOnce, type Shell } from "../../../../lib/query.ts";
import { readsPrivateRecord } from "../../private-record.ts";

const FIXTURE = new URL("../../../../fixtures/harness/terminal-bench/log-summary/repo/", import.meta.url);
const TARGET_EVAL = "evals/terminal-bench/log-summary.eval.ts";
const AGENT_FILE = "agents/canned-terminal-bench.ts";

const fixtureFiles = loadFixtureFiles(FIXTURE);
const probeAgent = await loadText(new URL("../../../../fixtures/harness/terminal-bench/log-summary/probe-agent.ts", import.meta.url));
const originalAgent = fixtureFiles.get(AGENT_FILE);
if (originalAgent === undefined) throw new Error(`fixture 缺少 ${AGENT_FILE}`);
const OFFICIAL_TEST = "evals/terminal-bench/log-summary.test.py";
const officialTest = fixtureFiles.get(OFFICIAL_TEST);
if (officialTest === undefined) throw new Error(`fixture 缺少 ${OFFICIAL_TEST}`);

// 目标 Eval 是要改的；experiments/local.ts 允许改，用来换 Python runtime 跑官方 test.py；
// README 是说明，顺手记一笔改动不算越界。其余（题面、官方判据、被测 Agent、另两条 Eval）受保护。
const EDITABLE = [TARGET_EVAL, "experiments/local.ts", "README.md"];

export default defineScoreEval({
  description: "把判得过紧的 log-summary Eval 改对：合法 CSV 通过，错误产物仍然失败",
  tags: ["harness", "harness-v2", "terminal-bench", "authoring", "criteria-repair", "single-turn"],
  timeoutMs: 30 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(pullInnerNodeImage).before(uploadDirectory({
    id: "fixture",
    source: FIXTURE,
    to: ".",
  })),
  async test(t) {
    // 与 log-summary 同一个起点：fixture 先跑完 local，agent 接手已经停稳的 Record。
    const shell: Shell = (script) => t.sandbox.runShell(script);
    await exp(shell, ["local"]);
    const initial = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
    const startingPoint = {
      "terminal-bench/classifier-debug": "failed",
      "terminal-bench/hello-world": "passed",
      "terminal-bench/log-summary": "failed",
    };
    if (!isDeepStrictEqual(initial, startingPoint)) {
      throw new Error(`fixture 未形成 1 passed / 2 failed 初始结果（实际：${JSON.stringify(initial)}），不能对 agent 判分`);
    }

    // 用户已经下了诊断，只要修。不提示“算错了还得失败”：不放水是文档该教会的事。
    const input = "local 跑完了，terminal-bench/log-summary 失败了。我看过产物，CSV 本身没问题，是这条 eval 判得太死。把它改好，复验一下，告诉我结果。";
    const turn = await t.send(input);
    turn.succeeded().key("harness.log-summary-repair.turn-succeeded").label("修复 Turn 成功");
    turn.notCalledTool(readsPrivateRecord)
      .key("harness.log-summary-repair.public-evidence").label("未观察到读取私有 Record（非完整文件审计）");

    // 先读 agent 自己留下的结果，外层探针运行之后会覆盖它们。
    const student = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
    t.log(JSON.stringify({ family: "log-summary", condition: "repair", student }));
    t.check(student, equals({ ...startingPoint, "terminal-bench/log-summary": "passed" })).score(3)
      .key("harness.log-summary-repair.student-runs").label("Agent 自己复验：log-summary 转为 passed，另两条保持原样");

    t.judge({ task: input, verifiedResults: student, reply: turn.reply }, yesNo("log-summary-repair-handoff",
      "verifiedResults 是外层通过公开 query 读到的 local 当前结果。最终回复是否与它一致地报告结果，说明改了哪条判据、为什么新判据仍会拒绝错误产物，" +
      "并且没有把 local 说成全部通过、没有把仍然失败的 classifier-debug 说成也已修好？用户没问 classifier-debug，不要求解释它为什么失败；" +
      "不要求粘贴 Run ID 或固定命令。"))
      .score(2).key("harness.log-summary-repair.handoff").label("交接与核验结果一致");
    // 沿用随题附带的官方 test.py 是正当修法，所以它和 Eval 正文一起交给 Judge；判据落在这两份之外才算读不出来。
    t.judge({ evalSource: await t.sandbox.readText(TARGET_EVAL).catch(() => ""), officialTest }, yesNo("log-summary-repair-readable",
      "evalSource 是改后的 log-summary Eval，officialTest 是随题附带、未被改动的官方 test.py。只读这两份，能否说出 summary.csv 什么样算通过：" +
      "表头、三类计数与行数各要求什么？evalSource 调用了 officialTest 时，其中的判据算已给出。" +
      "判据藏在这两份之外的辅助函数或文件里、或 evalSource 为空，判 N。"))
      .score(1).key("harness.log-summary-repair.readable").label("改后的判据读得出来");

    // 题面、判据或被测 Agent 被改过，后面的探针就不再证明 Eval 本身，任务算失败。
    await t.check(await changedFixtureFiles(t.sandbox, fixtureFiles, { except: EDITABLE }), equals([])).gate().key("harness.log-summary-repair.assets-unchanged")
      .label("题面、官方 test.py、被测 Agent 与另两条 Eval 保持不变").orStop();

    // 外层用同一个 local 配置把改后的 Eval 跑在一组已知产物上。每条都 --rerun all，从 receipt 的唯一 Run 读 verdict。
    const probe = async (name?: string) => {
      const env = name === undefined ? undefined : { HARNESS_CSV_PROBE: name };
      const run = await runOnce((script) => t.sandbox.runShell(script, { env }), ["local", "terminal-bench/log-summary", "--rerun", "all"]);
      t.log(JSON.stringify({ probe: name ?? "original", ...run }));
      return run.results;
    };
    const verdict = (value: "passed" | "failed") => ({ "terminal-bench/log-summary": value });

    try {
      await t.sandbox.writeText(AGENT_FILE, probeAgent);

      // 合法产物必须通过。原产物仍被拒绝就是没修好：没修的过紧 Eval 天然能拒绝错误产物，后面的拒绝探针证明不了任何事。
      await t.check(await probe(), equals(verdict("passed"))).gate().score(3)
        .key("harness.log-summary-repair.accept.original").label("原产物（全字段带引号）passed").orStop();
      t.check(await probe("plain"), equals(verdict("passed"))).score(2)
        .key("harness.log-summary-repair.accept.plain").label("不带引号的同一结果 passed");
      t.check(await probe("crlf-quoted"), equals(verdict("passed"))).score(2)
        .key("harness.log-summary-repair.accept.crlf-quoted").label("CRLF 换行的同一结果 passed");

      // 错误产物必须是 ordinary failed：没有产物是被测对象的业务失败，不是执行错误。
      t.check(await probe("wrong-count"), equals(verdict("failed"))).score(2)
        .key("harness.log-summary-repair.reject.wrong-count").label("ERROR 计数算错 failed");
      t.check(await probe("missing-row"), equals(verdict("failed"))).score(2)
        .key("harness.log-summary-repair.reject.missing-row").label("缺 INFO 行 failed");
      t.check(await probe("extra-row"), equals(verdict("failed"))).score(2)
        .key("harness.log-summary-repair.reject.extra-row").label("多出第五行 failed");
      t.check(await probe("no-header"), equals(verdict("failed"))).score(2)
        .key("harness.log-summary-repair.reject.no-header").label("缺表头 failed");
      t.check(await probe("missing-file"), equals(verdict("failed"))).score(2)
        .key("harness.log-summary-repair.reject.missing-file").label("没写 summary.csv 是 failed 而不是 errored");
    } finally {
      await t.sandbox.writeText(AGENT_FILE, originalAgent);
    }
  },
});
