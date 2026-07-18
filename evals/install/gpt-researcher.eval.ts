import { defineInstallEval } from "../../lib/install-eval.ts";

/**
 * 接入路径：真实开源项目 GPT Researcher（自动化研究报告 agent）。
 *
 * 协议是自研的 WebSocket JSON 帧（/ws）：发一帧起一次研究任务，服务端陆续推
 * logs / report 等私有事件帧，直到任务完成。没有任何内置件能直接对上，agent
 * 必须手写 send 并把这些私有帧映射成标准事件流——这是三个新 fixture 里唯一
 * 保留「手写流式协议映射」这条最长路径的一个。
 */
export default defineInstallEval({
  description: "把 niceeval 接入 GPT Researcher（自动化研究报告 agent）",
  repoUrl: "https://github.com/assafelovic/gpt-researcher.git",
  ref: "v3.6.0",
  hostSourceDirs: ["frontend"],
  expectedPages: [
    "docs-site/zh/how-to/write-send.mdx",
    "docs-site/zh/how-to/connect-your-agent.mdx",
    "docs-site/zh/reference/events.mdx",
  ],
  coreUseCase:
    "一个自动化研究报告 agent（GPT Researcher）：给定一个研究主题（如「2026 年固态电池行业进展」）" +
    "应该生成一份带小标题结构的报告，且至少引用一条真实来源链接；不应该在没有任何检索结果时" +
    "仍然编出一份看似完整的报告",
  transport: "WebSocket /ws（自研 JSON 帧协议：发起研究任务，陆续收 logs / report 等私有事件帧）",
});
