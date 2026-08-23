import { defineConfig } from "niceeval";
import { loadRepoEnv } from "./lib/env.ts";

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
  // 安装 Attempt 会同时 clone 大型宿主、运行内层 Docker，并把 Codex session 留在 tmpfs。
  // Docker provider 的通用默认并发 10 会先耗尽本机资源，因此这里固定整仓吞吐上限。
  maxConcurrency: 2,
  judge: {
    // 全仓产出质量统一交给 Sol 裁判。被测 Agent 由各 Experiment 单独选择；Harness 当前使用
    // Terra；裁判不再与被测模型混用。
    model: "gpt-5.6-sol",
    // 复用被测 codexAgent() 那把 CODEX_API_KEY/网关，不单独开一份 judge 凭证。
    // baseUrl 必须显式给：judge 的解析链曾经在省略时按 NICEEVAL_JUDGE_BASE → CODEX_BASE_URL →
    // OPENAI_BASE_URL 找，2026-07-25 起收敛成「只认 config 里的 judge.baseUrl，省略即官方端点」
    // （niceeval src/scoring/judge.ts）。不给的话 judge 会拿着网关的 key 打 api.openai.com，
    // 整个 run 在 precheck 阶段 401 硬失败。读同一个环境变量而不是手写字面量——网关地址仍然
    // 只有 .env 一处，跟 codexAgent() 用的是同一个值。
    baseUrl: process.env.CODEX_BASE_URL,
    apiKeyEnv: "CODEX_API_KEY",
  },

  // 常规上限；安装与迁移题会在各自 eval 上声明更长的 timeoutMs。
  timeoutMs: 20 * 60 * 1000,
});
