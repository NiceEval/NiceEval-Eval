import { regexLogRecoveryEval } from "./recovery.ts";

// 题面不提修复，观察 agent 是否自主恢复执行错误。判据见 recovery.ts。
export default regexLogRecoveryEval({
  id: "regex-log",
  name: "autonomous",
  description: "自主完成评估，观察是否恢复执行错误（rubric v2）",
  tag: "autonomous-repair",
  input: "把这次评估跑完，告诉我最终结果。",
});
