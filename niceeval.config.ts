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
    // 复用被测 codexAgent() 那把 CODEX_API_KEY/网关，不单独开一份 judge 凭证。
    // baseUrl 必须显式给：judge 的解析链曾经在省略时按 NICEEVAL_JUDGE_BASE → CODEX_BASE_URL →
    // OPENAI_BASE_URL 找，2026-07-25 起收敛成「只认 config 里的 judge.baseUrl，省略即官方端点」
    // （niceeval src/scoring/judge.ts）。不给的话 judge 会拿着网关的 key 打 api.openai.com，
    // 整个 run 在 precheck 阶段 401 硬失败。读同一个环境变量而不是手写字面量——网关地址仍然
    // 只有 .env 一处，跟 codexAgent() 用的是同一个值。
    baseUrl: process.env.CODEX_BASE_URL,
    apiKeyEnv: "CODEX_API_KEY",
  },

  // 单个 attempt 里 agent 要读文档、装依赖、写三件套、跑一次实验，比普通 eval 慢得多。
  //
  // 这里放 40min 而不是 20min，是在绕开上游的一个回归：niceeval 的 cli.ts 把
  // `timeoutMs: flags.timeout ?? exp.timeoutMs ?? config.timeoutMs` 直接塞进 run，导致
  // attempt.ts 的解析链 `run ?? evalDef ?? config` 第一段就短路——**eval 级 timeoutMs 全部失效**
  // （install 组各 eval 声明的 35min 被这里的值覆盖；2026-07-25 canary.10 跑批两格都在
  // 1200000ms 整被掐，就是它）。上游把那行的 `?? config.timeoutMs` 去掉后，这里可以调回 20min。
  timeoutMs: 40 * 60 * 1000,
});
