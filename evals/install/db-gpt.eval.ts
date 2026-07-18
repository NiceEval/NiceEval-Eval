import { defineInstallEval } from "../../lib/install-eval.ts";

/**
 * 接入路径：真实开源项目 DB-GPT（数据库对话式分析 + AWEL 工作流平台）。
 *
 * 仓库体积很大（完整 clone 接近 700MB，`docs/` 与 `assets/` 两个目录占了大头且与
 * 「装 niceeval」无关），所以用 excludeDirs 做 sparse-checkout 剪掉。协议是
 * OpenAI Chat Completions 兼容形状（/v2/chat/completions），但 niceeval 没有对应内置件——
 * 兼容标准形状不等于零映射，仍然要手写 send。
 */
export default defineInstallEval({
  description: "把 niceeval 接入 DB-GPT（数据库对话式分析 agent 平台）",
  repoUrl: "https://github.com/eosphoros-ai/DB-GPT.git",
  ref: "v0.8.1",
  excludeDirs: ["docs", "assets"],
  hostSourceDirs: ["web"],
  expectedPages: [
    "docs-site/zh/how-to/connect-your-agent.mdx",
    "docs-site/zh/how-to/write-send.mdx",
    "docs-site/zh/tutorials/quickstart.mdx",
  ],
  coreUseCase:
    "一个连着业务数据库的对话式数据分析 agent（DB-GPT）：问「这张表里销量最高的商品是什么」" +
    "应该返回具体的商品名并给出取数依据（查询了哪张表/哪个字段）；问数据源里不存在的表" +
    "应该明确答查不到，而不是编造结果",
  transport: "HTTP POST /api/v2/chat/completions（OpenAI Chat Completions 兼容协议，Bearer API key 鉴权）",
});
