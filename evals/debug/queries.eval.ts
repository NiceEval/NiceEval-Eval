import { loadYaml } from "niceeval/loaders";
import { type DebugQuestion, defineDebugEval } from "../../lib/debug-eval.ts";

/**
 * 题库扇出：一条题 = 一条 eval。
 *
 * 用 keyed record 而不是数组导出，是为了让 eval id 跟着题目的稳定 id 走
 * （queries/stale-experiments 而不是 queries/0003）。题库中间插一条新题时，
 * 其余题的 id 不动，历史结果还能跟新结果对上——这组评估的价值全在纵向可比。
 */
const questions = await loadYaml<DebugQuestion[]>(
  "fixtures/results/coding-agent-memory/questions.yaml",
);

const FIXTURE = { fixtureDir: "../../fixtures/results/coding-agent-memory" };

export default Object.fromEntries(
  questions.map((q) => [q.id, defineDebugEval(FIXTURE, q)]),
);
