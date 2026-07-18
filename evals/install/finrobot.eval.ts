import { defineInstallEval } from "../../lib/install-eval.ts";

/**
 * 接入路径：真实开源项目 FinRobot（股票研究 agent 平台）。
 *
 * `run_web_app.py`（README 里文档化的官方入口）跑的是「提交任务 + 轮询状态」的
 * 异步形状（POST /api/run 拿 task_id，GET /api/status/{task_id} 轮询），而不是
 * 一次同步请求就拿到结果——adapter 的 send 需要在内部做完这整套轮询，再把最终
 * 报告作为一次 turn 的结果返回给 niceeval。
 */
export default defineInstallEval({
  description: "把 niceeval 接入 FinRobot（股票研究 agent 平台）",
  repoUrl: "https://github.com/AI4Finance-Foundation/FinRobot.git",
  ref: "v1.0.0",
  expectedPages: [
    "docs-site/zh/how-to/connect-your-agent.mdx",
    "docs-site/zh/how-to/write-send.mdx",
    "docs-site/zh/tutorials/quickstart.mdx",
  ],
  coreUseCase:
    "一个股票研究 agent（FinRobot）：给定股票代码（如 NVDA）触发一次分析任务（POST /api/run 拿到 " +
    "task_id），轮询任务状态（GET /api/status/{task_id}）直到完成，取回的报告应该包含具体的财务" +
    "数据摘要与结论，而不是一句空泛的「分析已完成」",
  transport: "HTTP（POST /api/run 提交任务 + GET /api/status/{task_id} 轮询，JSON 请求/响应）",
});
