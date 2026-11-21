import { tasteReviewer } from "../../judges/niceeval-taste.ts";
import { defineScoreEval } from "niceeval";
import { equals, binaryJudge } from "niceeval/expect";
import { loadText } from "niceeval/loaders";
import { sandboxRequirements, uploadDirectory } from "niceeval/sandbox";

import { readFileSync } from "node:fs";
import { currentVerdicts, query, runOnce, type Shell } from "../../../lib/query.ts";
import { readsImplementation } from "../implementation-read.ts";
import { readsPrivateRecord } from "../private-record.ts";

const FIXTURE = new URL("../../../fixtures/harness/multiturn-authoring/repo/", import.meta.url);
const AGENT_FILE = "agents/booking-bot.ts";

const probeAgent = await loadText(new URL("../../../fixtures/harness/multiturn-authoring/probe-agent.ts", import.meta.url));
const originalAgent = readFileSync(new URL(AGENT_FILE, FIXTURE), "utf8");

// 用户新增 Eval，可以补 README；机器人、运行配置和项目配置受保护。
const PROTECTED: [string, ...string[]] = [AGENT_FILE, "experiments/local.ts", "niceeval.config.ts"];

export default defineScoreEval({
  description: "给订房机器人写多轮 Eval：先问清两个日期，再用用户提供的日期下单",
  tags: ["harness", "harness-v2", "authoring", "process-assertion", "multi-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  sandbox: sandboxRequirements({}).before(uploadDirectory({ id: "fixture", source: FIXTURE, to: "." })),
  async test(t) {
    const input = "给订房机器人加一条评估：用户只说『下周末帮我订个房』时，它得先问清入住和退房日期，等用户答了才能下单，下单用的日期必须是用户给的。写好跑一下 local，告诉我结果。";
    const turn = await t.send(input);
    turn.succeeded().label("authoring Turn 成功");
    await t.group("NiceEval 品味", () => {
      const reviewIntro = "agent 给订房机器人新增了多轮评估，要求先问清入住和退房日期，再用用户回答的日期下单。先读完新写的评估文件。";
      const reviewEvalClarity = t.agentJudge(tasteReviewer, { evalDir: "evals/" });
      reviewEvalClarity.chat(reviewIntro);
      const reviewEvalFacts = t.agentJudge(tasteReviewer, { evalDir: "evals/" });
      reviewEvalFacts.chat(reviewIntro);
      const reviewMissingEvidence = t.agentJudge(tasteReviewer, { evalDir: "evals/" });
      reviewMissingEvidence.chat(reviewIntro);
      reviewEvalClarity.judge(
        "只读 agent 写的 Eval 正文就能说出它测什么、每项什么算通过、分数或门槛怎么来；" +
        "关键阈值、数量和分值直接写在检查上，没有藏进辅助函数，也没有先装进数组再用循环登记。")
        .score(1).label("判据平铺在打分处");
      reviewEvalFacts.judge(
        "能直接读到的事实（工具名与参数、次数、文件内容、命令退出码、结构化字段）用确定性检查，" +
        "没有把这类事实交给 Judge 判断。")
        .score(1).label("事实用确定性检查");
      reviewEvalClarity.judge(
        "能用现成 Match（equals、includes、pattern、toolMatch、countWhere、referencesAnyPath 等）表达的判据，" +
        "没有先手算成布尔值或计数，再交给 isTrue 或 equals(true)。")
        .score(1).label("判据写在 Match 上");
      reviewMissingEvidence.judge(
        "缺失的数据（缺记录、解析失败、读不到文件）保留为不可判定或直接报错，没有补成 0、false 或空字符串后继续判分。")
        .score(1).label("未知保持未知");
    });
    t.notCalledTool(readsPrivateRecord).label("未观察到读取私有 Record（非完整文件审计）");
    t.notCalledTool(readsImplementation).score(3).label("没有读 NiceEval 实现代码");
    t.sandbox.changedOnlyWithin(["evals", "README.md"]).label("范围检查：只改 evals/ 与 README");
    const shell: Shell = (script) => t.sandbox.runShell(script);
    const student = currentVerdicts(await query(shell, { kind: "experiment.get", experimentId: "local" }));
    const added = Object.keys(student).filter((id) => id !== "booking/explicit-dates").sort();
    t.log(JSON.stringify({ family: "multiturn-authoring", student, added }));
    t.check(added.length > 0 && added.every((id) => student[id] === "passed"), equals(true))
      .score(3).label("Agent 自己的运行：新评估 passed");
    t.judge({ reply: turn.reply, verifiedResults: student }, binaryJudge({ rubric:
      "最终回复说明新增的评估验证先问清两个日期、等用户回答才下单且日期来自回答，运行结果与 verifiedResults 一致。未实际发布的新评估不可以说已跑通。" }))
      .score(2).label("交接与核验一致");
    t.sandbox.unchangedWithin(PROTECTED).gate().label("机器人、运行配置与项目配置不变");
    // new Eval 的身份由实际发布结果确定；空集合不能靠 vacuous truth 通过探针 gate。
    const probe = async (name: string) => {
      const run = await runOnce((script) => t.sandbox.runShell(script, { env: { HARNESS_BOOKING_PROBE: name } }), ["local", "--rerun", "all"]);
      t.log(JSON.stringify({ probe: name, ...run }));
      const ids = Object.keys(run.results).filter((id) => id !== "booking/explicit-dates").sort();
      return { ids, results: Object.fromEntries(ids.map((id) => [id, run.results[id]])) };
    };
    const expected = (verdict: "passed" | "failed") => ({ ids: added, results: Object.fromEntries(added.map((id) => [id, verdict])) });
    try {
      await t.sandbox.writeText(AGENT_FILE, probeAgent);
      await t.check({ added: added.length > 0, ...(await probe("correct")) }, equals({ added: true, ...expected("passed") }))
        .gate().score(3).label("correct：先问清再按用户日期下单 passed").orStop();
      t.check(await probe("correct-reworded"), equals(expected("passed"))).score(2).label("接受语义等价的澄清与确认");
      t.check(await probe("book-immediately"), equals(expected("failed"))).score(3).label("book-immediately：第一轮猜日期下单 ordinary failed");
      t.check(await probe("never-book"), equals(expected("failed"))).score(2).label("never-book：用户回答后不下单 ordinary failed");
      t.check(await probe("wrong-dates"), equals(expected("failed"))).score(3).label("wrong-dates：下单日期不是用户给的 ordinary failed");
      t.check(await probe("checkin-only"), equals(expected("failed"))).score(2).label("checkin-only：只问入住、自己补退房日期 ordinary failed");
    } finally {
      await t.sandbox.writeText(AGENT_FILE, originalAgent);
    }
  },
});
