import { defineInstallEval } from "../../lib/install-eval.ts";

/**
 * 接入路径：真实开源项目 Vanna（自然语言转 SQL 的 agent 框架）。
 *
 * 宿主是 Python 项目，没有 package.json，agent 必须走 INIT.md 第 1 步那条分支——
 * 就地新建一个 package.json 来承载三件套。协议是 Vanna 自己的 JSON 请求/响应
 * （chat_poll，非流式），没有任何内置件能直接对上，考的是「手写 send + 读懂真实业务」。
 */
export default defineInstallEval({
  description: "把 niceeval 接入 Vanna（自然语言转 SQL 的开源 agent 框架）",
  repoUrl: "https://github.com/vanna-ai/vanna.git",
  ref: "v2.0.2",
  hostSourceDirs: ["frontends"],
  expectedPages: [
    "docs-site/zh/how-to/connect-your-agent.mdx",
    "docs-site/zh/how-to/write-send.mdx",
    "docs-site/zh/tutorials/quickstart.mdx",
  ],
  coreUseCase:
    "一个自然语言转 SQL 的数据库问答 agent（Vanna）：问「上个月的销售总额是多少」应该生成一条" +
    "含 SELECT 与聚合函数（如 SUM）的 SQL，并执行后返回具体数值；问知识库训练数据之外的表" +
    "应该明确答不知道，而不是编造字段名",
  transport: "HTTP POST /api/vanna/v2/chat_poll（Vanna 自研 JSON 请求/响应，非流式）",
});
