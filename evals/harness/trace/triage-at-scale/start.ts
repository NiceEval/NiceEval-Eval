import { isDeepStrictEqual } from "node:util";
import { attemptTraceReader } from "../../../../lib/attempt-trace.ts";
import { exp, query, type Shell } from "../../../../lib/query.ts";

const EVAL_IDS = [
  "account/delete", "account/email-change", "account/password-reset", "account/points",
  "billing/invoice", "billing/partial-refund", "billing/payment-methods", "billing/refund-amount", "billing/refund-status",
  "catalog/compare", "catalog/search", "catalog/stock",
  "returns/address", "returns/exchange", "returns/label", "returns/window",
  "shipping/carrier", "shipping/cost", "shipping/coverage", "shipping/eta",
  "support/contact", "support/gift-wrapping", "support/greeting-zh", "support/hours",
];
const OLD_FAILURES = ["catalog/search", "catalog/compare"];
const NEW_FAILURES = ["billing/refund-amount", "billing/partial-refund", "support/greeting-zh", "account/delete"];
const expected = (today: boolean) => Object.fromEntries(EVAL_IDS.map((id) => [id,
  today && id === "returns/label" ? ["errored", "errored", null] :
  today && id === "shipping/eta" ? ["failed", "passed", "passed"] :
  Array<string>(3).fill(OLD_FAILURES.includes(id) || (today && NEW_FAILURES.includes(id)) ? "failed" : "passed"),
]));

type PlannedAttempt = {
  evalId: string;
  verdict?: string | null;
  state?: string;
  publication?: { attemptLocator?: string };
};

async function checkLabelDiagnostics(shell: Shell, attempts: readonly PlannedAttempt[]) {
  const readTrace = await attemptTraceReader(shell);
  const errored = attempts.filter((attempt) => attempt.evalId === "returns/label" && attempt.verdict === "errored");
  for (const attempt of errored) {
    const locator = attempt.publication?.attemptLocator;
    if (typeof locator !== "string") throw new Error("fixture 的退货标签错误缺少公开 Attempt locator");
    const diagnostics = (await readTrace(locator)).diagnostics?.items;
    if (!Array.isArray(diagnostics) || !diagnostics.some(({ code, summary, summaryTruncated }) =>
      code === "agent-send-failed" && summaryTruncated !== true &&
      typeof summary === "string" && /^Return label command jq failed \(exit 127\): .*\bjq: (?:command )?not found$/m.test(summary),
    )) {
      throw new Error(`fixture 的退货标签错误 ${locator} 未公开报告 jq 缺失及 exit 127：${JSON.stringify(diagnostics)}`);
    }
  }
}

export async function prepareTriageFixture(shell: Shell, writeText: (path: string, text: string) => Promise<unknown>) {
  // 同一个 Experiment 留下两个 Run；从 receipt 的唯一 Run 核对全部 72 个计划槽位，
  // 今天 label 的第三个槽位由 fail-fast 停止派发，其余槽位必须全部执行。
  // 不用 experiment.get 的最新格覆盖昨天，也不把每格三次采样压成一次 verdict。
  const setup = async (day: "yesterday" | "today") => {
    await writeText("day.txt", `${day}\n`);
    const receipt = await exp(shell, ["nightly", "--rerun", "all"]);
    const [runId] = receipt.runIds;
    if (!runId || receipt.runIds.length !== 1) {
      throw new Error(`${day} 应创建唯一 Run，实际 ${JSON.stringify(receipt)}`);
    }
    const document = await query(shell, { kind: "run.get", runId });
    const attempts: PlannedAttempt[] = document.run.plannedAttempts;
    const verdicts = Object.fromEntries(EVAL_IDS.map((id) => [id,
      attempts.filter((attempt) => attempt.evalId === id).map((attempt) => attempt.verdict ?? null).sort(),
    ]));
    if (attempts.length !== 72 || !isDeepStrictEqual(verdicts, expected(day === "today"))) {
      throw new Error(`${day} fixture 未形成预期的 24 × 3 结果：${JSON.stringify({ runId, verdicts, attempts: attempts.length })}`);
    }
    const unobserved = attempts.filter((attempt) => attempt.verdict == null);
    if (day === "today" && (unobserved.length !== 1 || unobserved[0]?.evalId !== "returns/label" ||
        unobserved[0]?.state !== "not-dispatched")) {
      throw new Error(`今天必须仅有 label 的第三次由 fail-fast 停止派发：${JSON.stringify(unobserved)}`);
    }
    if (day === "today") await checkLabelDiagnostics(shell, attempts);
    // 不依赖 publication.reason 的具体值；该字段的呈现由 NiceEval 负责。
    return runId;
  };
  // 可重放 setup：上次已把开关恢复只读时，先允许外层写入。Agent 接手时只读。
  const writable = await shell("chmod u+w day.txt");
  if (writable.exitCode !== 0) throw new Error(`无法准备 day.txt：${writable.stderr}`);
  let yesterday: string;
  let today: string;
  try {
    yesterday = await setup("yesterday");
    today = await setup("today");
  } finally {
    const readonly = await shell("chmod 444 day.txt");
    if (readonly.exitCode !== 0) throw new Error(`无法将 day.txt 恢复只读：${readonly.stderr}`);
  }
  if (today === yesterday) throw new Error("昨天与今天必须是不同的 Run");
  return { yesterday, today };
}
