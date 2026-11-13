/**
 * 两道安装题共用的一组判据：agent 写出的 Eval 有没有 NiceEval Taste。
 * 这份清单对任何宿主都一样（随包 niceeval-taste.mdx 的自检清单），所以只写一份；
 * 与宿主有关的判据留在各题 eval.ts 里。
 */

/** [key, label, points, rubric]：每条可以独立缺失，各计 1 分。 */
export const TASTE_RUBRICS = [
  ["install.taste.readable", "正文读得出判据", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当只读 Eval 正文就能说出它测什么、每项什么算通过、分数或门槛怎么来；" +
    "关键阈值、数量和分值直接写在检查上，没有藏进辅助函数。"],
  ["install.taste.deterministic-facts", "事实用确定性检查", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当能直接读到的事实（工具名与参数、次数、文件内容、命令退出码、结构化字段）" +
    "用确定性检查，没有把这类事实交给 Judge 判断。"],
  ["install.taste.match-over-arithmetic", "判据写在 Match 上", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当能用现成 Match（equals、includes、pattern、toolMatch、countWhere 等）表达的判据，" +
    "没有先手算成布尔值或计数，再交给 isTrue 或 equals(true)。"],
  ["install.taste.unknown-stays-unknown", "未知保持未知", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当缺失的数据（缺记录、缺 token、解析失败）保留为不可判定或直接报错，" +
    "没有补成 0、false 或空字符串后继续判分。"],
  ["install.taste.stop-on-prerequisite", "前提失败即停", 1,
    "只看 evals/ 下 agent 写的 Eval 文件。Y 当且仅当后续检查依赖的前提（如本轮成功、服务可达）不满足时，用 orStop 或等价方式停下，" +
    "不在前提已失败时继续给依赖它的项判分。没有这种依赖关系时判 Y。"],
] as const;
