# 安装题：LLM 社交游戏（llm-x）与 ComfyUI 占位

现有安装题的被测应用都是 agent 或 agent 扩展：DB-GPT、GPT Researcher 是对话式 agent，Concord 评的是随包 skill。这道题的目标应用两者都不是：它是一个 **LLM 驱动的社交游戏**，接入方式是 NiceEval 的「自定义应用」。题目同时测两件事：

- **自动 HITL**：需求只写在模拟用户的 instructions 里，首条 prompt 不给任何需求。被测 Codex 只有通过原生提问（`request_user_input`，Turn 进入 `waiting`）才能拿到需求。
- **满足需求**：Codex 最后交出的评估，有没有真的覆盖用户提的每一条需求。

## 目标应用

来源是 NiceEval 仓库 `examples/zh/llm-x`，锁定提交 `ff993bd6e8da4966ae4f7b6687b0f38c0a38496c`。这是一个 AI 驱动的 X/贴吧式社交游戏：`createWorld` 生成人物和初始动态，玩家可以发帖、回复、刷新动态、生成配图，AI 人物在后台回应。Next.js 后端加 SQLite，live 模式通过 OpenAI 兼容接口调用文字模型（Responses + JSON Schema）和图片模型（`images/generations`）。

**Fixture 放在本仓库** `fixtures/install/llm-x/`，内容是去掉 NiceEval 接入后的原始应用：

- 删除 `evaluation/`、`evals/`、`experiments/`、`niceeval.config.ts`，以及 `package.json` 里的 `niceeval` 依赖和 `eval` / `eval:live` 脚本、`pnpm-workspace.yaml` 里的 niceeval override。
- README 删除「用 NiceEval 评估」整节（含「真实模型与内容评分」），以及其它提到 NiceEval、Judge、Eval 的句子。保留应用说明、直接运行、Live provider 和 Typed 应用 API。参考实现一旦漏进 fixture，agent 直接照抄就能拿分，这道题就测不出东西。
- 用 pnpm 重新生成不含 niceeval 的 `pnpm-lock.yaml`；`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm build`、`pnpm smoke` 必须在 fixture 上通过。
- 题目的 before：把 fixture 上传到工作区，`git init` 并提交 baseline，写法同 Concord 题。

## 模型出口（2026-11-15 实测后修订）

共享的 `target-app.env` 指向 DeepSeek 网关：Responses 结构化输出可用，但 `/models` 里没有图片模型，`images/generations` 对四个图片模型都返回 404。`CODEX_BASE_URL` 网关有 `gpt-image-1`、`gpt-image-2`，最低画质请求返回 200 和 `b64_json`，但必须带 Cloudflare Access 头（`CF-Access-Client-Id`、`CF-Access-Client-Secret`），不带就是 403。

因此：

- **llm-x 的文字和图片都走 `CODEX_BASE_URL` 网关。** 图片模型 `gpt-image-1`；文字模型由 worker 在该网关上挑一个支持 Responses + `json_schema` 的较便宜模型并实测，写进下面的题目 before。
- **fixture 应用加一个可选配置 `OPENAI_EXTRA_HEADERS`**：JSON 对象，附加到文字和图片的每个 provider 请求上；不设时行为与原应用完全相同。README 的 Live provider 一节把它写成普通功能（经过需要额外请求头的代理时使用），不提评测。这是对我们自己 fixture 副本的改动，不改 NiceEval 仓库的示例。
- **题目自己的 before 写 `/opt/fixture-secrets/llm-x.env`**，内容来自宿主的 `CODEX_API_KEY`、`CODEX_BASE_URL`、`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`，写法照抄 `lib/target-app-env.ts` 的回调步骤，但代码完整写在 eval 文件里，不改 `lib/**`。文件权限与 `target-app.env` 相同。
- Judge 不走这个网关，用 `target-app.env` 的 DeepSeek 网关和 `deepseek-flash`（worker 实测 Chat Completions 200），与应用的文字模型分开。

## 模拟用户（需求只在这里）

instructions 写明：

- 身份：你是这个 LLM 社交游戏的作者，刚让 agent 把 NiceEval 装进来。只回答被问到的事；没决定的事让它依据仓库和随包文档自己判断。
- 需求（被问到要评估什么时如实说出全部四条）：
  1. **发帖遵循意图**：玩家给出发帖意图后，生成的帖子内容要遵循这个意图。
  2. **AI 回应接得上**：玩家回复某条帖子后，后台回应必须来自世界里存在的人物，内容回应被回复的帖子，并符合该人物主页的设定。
  3. **刷新有新内容**：刷新动态后出现新内容，而且不和已有动态重复。
  4. **配图附对位置**：要求配图时，图片附在正确的帖子上；不评判画面质量。
- 已定决定：Tier 1，不接 OTel；用 live 真实模型。应用的全部配置在 `/opt/fixture-secrets/llm-x.env`（`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_IMAGE_MODEL`、`OPENAI_EXTRA_HEADERS`），只能在运行时注入应用进程，不能输出、复制进工作区或提交。Judge 用 `/opt/fixture-secrets/target-app.env` 里的网关（`OPENAI_API_KEY`、`OPENAI_BASE_URL`），模型 `deepseek-flash`，走 Chat Completions。首跑最多 2 个 Attempt，可以自主运行、诊断和重试，但本次任务总共不超过 6 个 Attempt。

## 流程

```ts
const first = await t.send(`READ ${candidateInitDocUrl(version)} and install niceeval for this repo.\nUse niceeval@${version} exactly.`);
const user = t.simulatedUser(owner);
let turn = first;
let answered = 0;
while (turn.status === "waiting" && answered < 6) {
  turn = await user.reply(turn);
  answered += 1;
}
t.note("HITL 回答次数", answered);
```

- 只在 Turn 处于 `waiting` 时由模拟用户回答。Codex 一次都没有进入 HITL（包括只在回复文字里提问然后结束这一轮）时，模拟用户不发任何消息，直接按它交出的结果判分。
- 上限 6 次只防失控，不是期望次数。

## 评分

计分制。分值是设计意图，worker 实现后在交付里报告实际合计。

**澄清（HITL）**

| 项 | 分 | 方式 |
| --- | --- | --- |
| 进入 HITL | 2 | 确定性：`answered >= 1` |
| 问到评估目标 | 2 | Judge：Codex 的原生提问里有没有问要评估什么，或者给出具体候选让用户选；只问版本、路径这类可以自己查的事不算 |
| 问到 Judge | 1 | Judge：问了 Judge 用哪个服务或模型，或者说明没有 Judge 时先写确定性判据 |
| 问到预算 | 1 | Judge：在真实运行前问了 Attempt 数、时间或费用预算 |

Judge 的材料是全部 `waiting` Turn 的 `input.requested` 提问加上模拟用户的回答。没有进入 HITL 时，这几项的材料为空，按未满足判分，不报错。

**需求满足**（Agent Judge 读 baseline 之后的 diff，在源码里取证）

| 项 | 分 |
| --- | --- |
| 需求 1：有 Eval 走真实发帖路径，并检查内容遵循意图（开放内容用 Judge 或等价的语义判据，不用关键词） | 3 |
| 需求 2：有 Eval 回复帖子后等到 AI 回应，检查回应者存在、回应切题、符合人设 | 3 |
| 需求 3：有 Eval 刷新动态，检查出现新内容且不重复 | 3 |
| 需求 4：有 Eval 要求配图，检查图片附在正确的帖子上，不声称评判画面质量 | 3 |

**接入形态**（Agent Judge）

| 项 | 分 |
| --- | --- |
| 用自定义应用接口（`defineAdapter` 暴露发帖、回复、刷新、配图等业务操作），不是把应用硬套成聊天 `send` | 3 |
| live 模式真实调用模型，凭据从 env 文件在运行时读取并只注入应用进程，不硬编码、不打印、不进工作区 | 2 |
| 应用生命周期：构建、启动、就绪检查、使用临时数据库、失败时也能清理 | 2 |

**宿主安装与真实运行**：照抄 GPT Researcher / Concord 题已有的宿主安装规范和 root gate（根目录精确声明候选版本、保留 pnpm、冻结锁安装、根目录 CLI、config、discovery、dry），以及「至少一次非 errored 的真实运行，并在交接里给出 Run 定位」。另加确定性检查：agent 创建的全部 Run 合计 Attempt 不超过 6（预算遵守，1 分）。

## 题目约束

- 文件：`evals/install/llm-x/eval.ts`、`fixtures/install/llm-x/**`。判据各自完整写在 eval 文件里，从已有安装题复制，不抽公共模块（见 [eval-duplication](new-evals-2026-11.md)）。
- 不改 `lib/**`、`experiments/**` 和任何已有题目：改了会让已有格的结果作废。
- 标签 `["install", "llm-x", "holdout"]`；保留规则同 [new-evals-2026-11](new-evals-2026-11.md)。
- `timeoutMs` 85 分钟，受共享 Instabox 实例寿命 90 分钟限制。
- 由 install 实验现有的 `evals: ["install/"]` 自动选中，不新增 Experiment。

## ComfyUI 占位

`evals/install/comfyui/eval.ts`：以后要做 ComfyUI 的安装题，现在先占一个位置。`test` 里直接 `t.skip("ComfyUI 安装题尚未设计")`，标签 `["install", "comfyui", "placeholder"]`，不写 fixture、判据和 Sandbox 步骤。要确认跳过不会创建 Instabox 实例、不花模型费用；做不到的话，在交付里报告具体代价。

## 验收

- `pnpm run typecheck` 通过；`niceeval exp install/v0.21.0 --dry` 显示新增的 llm-x、comfyui 两格，已有格的沿用状态不变。
- 在 0.21.0 上真实跑一次 llm-x：被测 agent 进入题目正文，判据都给出了判定，没有因为题目自身的缺陷而 errored。是否 passed 不是验收条件。
- 在 Sandbox 里用 `llm-x.env` 实际跑通一次 fixture 应用的 live 模式（建世界、发帖带图），再开始真实运行题目；跑不通时停下来报告，不要自行换成 fixture 模式或删掉配图需求。
