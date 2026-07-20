import { defineConfig } from "niceeval";
import { loadRepoEnv } from "./lib/env.ts";

/**
 * 本仓库是 niceeval 的「文档效果评估仓库」：被测对象是正在使用 niceeval 的 coding agent，
 * 评的是 INIT.md 与随包 INDEX.md 这套文档链对 AI 的实际效果。
 *
 * 它同时也是一个正常的 niceeval 用户项目——niceeval 用自己评估自己的安装与诊断体验。
 */

// 这是本仓库任何 niceeval CLI 调用都会先加载的入口文件，所以在这里把仓库根 .env 灌进
// process.env——CODEX_API_KEY 既是被测 codexAgent() 的鉴权（见 experiments/shared.ts），
// 也是下面 judge.apiKeyEnv 指的那个变量，必须在两边真正用到之前就位。
loadRepoEnv();

export default defineConfig({
  judge: {
    // 产出质量层用 judge 打分。裁判模型本该与被测模型分离，不让同一个模型给自己打分——
    // 但 gpt-5.4-mini 在 x1api.top 这把 key 下 404（这个网关这组账号不认这个模型名），
    // 换成这把 key 下已确认可用的 gpt-5.6-luna。install/ 两组实验（v0.9.1.ts / v0.4.ts）
    // 被测 agent 也用的是 gpt-5.6-luna，这组 judge 因此不再跟被测模型分离——如果产出质量层
    // 的分数看着不对劲，先怀疑这个，而不是文档效果本身。
    model: "gpt-5.6-luna",
    // 复用被测 codexAgent() 那把 CODEX_API_KEY/网关，不单独开一份 judge 凭证。不写 baseUrl：
    // niceeval 的 judge 解析链（node_modules/niceeval/src/scoring/judge.ts）省略时按
    // NICEEVAL_JUDGE_BASE → CODEX_BASE_URL → OPENAI_BASE_URL 顺序找，CODEX_BASE_URL 排第二，
    // 跟 codexAgent() 自己读的是同一个变量——这里手写字面量只会变成又一处要手动保持同步的地方。
    apiKeyEnv: "CODEX_API_KEY",
  },

  // 单个 attempt 里 agent 要读文档、装依赖、写三件套、跑一次实验，比普通 eval 慢得多
  timeoutMs: 20 * 60 * 1000,
});
