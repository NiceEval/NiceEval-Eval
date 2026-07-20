/**
 * 烘焙一个带 Python 工具链的 e2b template，派生自本仓库自己的 Node 24 template
 * （见 scripts/build-e2b-node24-template.ts），不是直接从原始 codex template 派生——
 * 官方 codex template 实测是 Node v20.9.0，「默认」与「python」这两个 environment profile
 * 得共用同一条 Node 24 基线，否则 Python 组会漂回 v20，被 assertNodeMajor(24) 拦下。
 *
 * BASE_TEMPLATE 必须跟 experiments/shared.ts 里默认 `template` 字段填的那个 ref 一致——
 * 重新烘焙 node24 template 换了新 tag 后，这里也要跟着换，两处手动同步。
 *
 * 装的东西对齐 `lib/fixture-env.ts` 里 `provisionTargetAppEnv()` 原本在运行时装的那一套：
 * DB-GPT / GPT Researcher / Vanna 三条接入路径都是真实 Python 项目要用到的最小工具链。
 * 模板烘焙好之后，那个钩子里对应的 apt-get/uv 安装段就该整段删掉——变成运行时只做一次
 * `command -v` 探测的保险丝，真正的安装成本从「每个 attempt」降到「模板更新时才付一次」。
 *
 * 用法：
 *   # .env 里加一行 E2B_API_KEY=e2b_...（`e2b auth login` 只登录 CLI，Node SDK 的
 *   # Template.build() 走另一条认证路径，只认这个环境变量：
 *   # https://e2b.dev/dashboard?tab=keys）
 *   pnpm exec tsx scripts/build-e2b-python-template.ts [tag]   # tag 省略则用今天日期
 *
 * 跑完会打印一个完整 template ref（形如 `<team>/niceeval-eval-python:<tag>`）。把它填进
 * `experiments/shared.ts` 的 `NICEEVAL_EVAL_PYTHON_E2B_TEMPLATE`，再把
 * `evals/install/{vanna,db-gpt,gpt-researcher}.eval.ts` 的 `defineEval({ environment: "python", ... })`
 * 打开——这两步我先没做，因为在拿到真实 template ref 之前打开会导致这三条 eval 在
 * plan 阶段就找不到 environment profile 而报错。
 */

import { Template } from "e2b";
import { ENV_FILE, loadRepoEnv } from "../lib/env.ts";

loadRepoEnv();
if (!process.env.E2B_API_KEY) {
  throw new Error(`${ENV_FILE} 里缺 E2B_API_KEY。去 https://e2b.dev/dashboard?tab=keys 拿一个，加进 .env。`);
}

// 跟 experiments/shared.ts 默认 template 字段手动保持一致
const BASE_TEMPLATE = "niceeval-eval-codex-node24:2026-07-20";

const tag = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const name = `niceeval-eval-python:${tag}`;

const template = Template()
  .fromTemplate(BASE_TEMPLATE)
  .aptInstall(["python3", "python3-pip", "python3-venv", "build-essential", "curl", "git", "sqlite3"])
  .runCmd('UV_INSTALL_DIR=/usr/local/bin sh -c "curl -LsSf https://astral.sh/uv/install.sh | sh"', {
    user: "root",
  })
  .runCmd('ln -sf "$(command -v python3)" /usr/local/bin/python', { user: "root" });

console.log(`构建 ${name}（基于 ${BASE_TEMPLATE}）…`);
const info = await Template.build(template, name, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: (entry) => console.log(`  ${entry.message}`),
});

console.log(`\n构建完成：${name}（templateId: ${info.templateId}）`);
console.log(`把 ${JSON.stringify(name)} 填进 experiments/shared.ts 的 NICEEVAL_EVAL_PYTHON_E2B_TEMPLATE`);
