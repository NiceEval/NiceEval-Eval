import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
import { cloudflareAccessHeaders, loadRepoEnv } from "./lib/env.ts";

/**
 * 本仓库是 niceeval 的「文档效果评估仓库」：被测对象是正在使用 niceeval 的 coding agent，
 * 评的是 INIT.md 与随包 INDEX.md 这套文档链对 AI 的实际效果。
 *
 * 它同时也是一个正常的 niceeval 用户项目——niceeval 用自己评估自己的安装与诊断体验。
 */

// 这是本仓库任何 niceeval CLI 调用都会先加载的入口文件，所以在这里把仓库根 .env 灌进
// process.env——CODEX_API_KEY 既是被测 codexAgent() 的鉴权（见 experiments/ 各版本配置），
// 也是下面 judge.apiKeyEnv 指的那个变量，必须在两边真正用到之前就位。
loadRepoEnv();

export default defineConfig({
  // 本地开发默认失败挂起便于直连现场排查，CI 环境自动禁用
  pauseOnFailure: !process.env.CI,

  // 启用 Instabox 并发调度
  maxConcurrency: 10,
  judgeProvider: OpenAIProvider({
    // 裁判使用 GPT-6 Astra；各 Experiment 的被测 Agent 使用 GPT-6.1 Sol。
    model: "gpt-6-astra",
    // 复用被测 codexAgent() 的 CODEX_API_KEY 与网关。judge 不从环境推断端点，
    // 省略 baseUrl 会拿网关 key 打官方端点并在 precheck 401。
    baseUrl: process.env.CODEX_BASE_URL,
    apiKeyEnv: "CODEX_API_KEY",
    headers: cloudflareAccessHeaders(),
  }),

  // 常规上限；安装与迁移题会在各自 eval 上声明更长的 timeoutMs。
  timeoutMs: 20 * 60 * 1000,
});
