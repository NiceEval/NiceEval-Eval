import { defineConfig } from "niceeval";

/**
 * 本仓库是 niceeval 的「文档效果评估仓库」：被测对象是正在使用 niceeval 的 coding agent，
 * 评的是 INIT.md 与随包 INDEX.md 这套文档链对 AI 的实际效果。
 *
 * 它同时也是一个正常的 niceeval 用户项目——niceeval 用自己评估自己的安装与诊断体验。
 */
export default defineConfig({
  judge: {
    // 产出质量层用 judge 打分。裁判模型必须与被测模型分离：
    // 被测 agent 是 codex（gpt 系），裁判固定用 mini 档，不让同一个模型给自己打分。
    model: "gpt-5.4-mini",
    // 用 OpenAI 之外的兼容服务时打开这两行：
    // baseUrl: "https://api.deepseek.com/v1",
    // apiKeyEnv: "DEEPSEEK_API_KEY",
  },

  // 单个 attempt 里 agent 要读文档、装依赖、写三件套、跑一次实验，比普通 eval 慢得多
  timeoutMs: 20 * 60 * 1000,
});
