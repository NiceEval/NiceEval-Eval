/**
 * 目标应用（DB-GPT / GPT Researcher / Vanna）运行时环境。
 *
 * 这三条接入路径的被测宿主都是真实 Python 项目，Python 工具链（python3 / pip / venv /
 * build-essential / sqlite3 / uv）已经烘焙进专用 e2b template（见 scripts/build-e2b-python-template.ts
 * 与 experiments/shared.ts 的 `environments.python`），这三条 eval 各自声明
 * `environment: "python"` 换到那个 template。这个钩子不再装系统依赖，只做每次 attempt
 * 都要重新写的动态内容——目标应用自己要连的 LLM 凭证。装 niceeval 三件套这件事跟
 * 「目标应用能不能被 agent 实际启动起来」是两层问题：前者由 assertNiceevalInstalled gate，
 * 后者只在「跑出过一次结果」那条软断言里体现（详见 evals/install/share/eval-adapter.ts 的注释）。这个钩子补的
 * 是后者的地基——把「能连一个真 LLM」这个前提准备好，但不替 agent 决定要不要启动目标进程，
 * 也不做任何 gate。
 *
 * 值不写进代码：从仓库根 `.env`（已加入 .gitignore）读，缺失就 fail-fast，避免「装完了但连不上
 * LLM」被误判成 agent 没写对 adapter。
 *
 * 凭证放在 workdir 之外（TARGET_APP_ENV_PATH），且不在 t.send() 的任务文案里提它——三条
 * 接入路径考的是 agent 能不能把 niceeval 接对，不是我们在旁边报答案。真实开发者接手一个
 * 项目时，密钥往往也是「找得到就有，找不到就得自己问/查」，不是任务描述里写好的。
 *
 * 验证时踩过的坑（供人读，不进 send，别复读给 agent）：
 * - GPT Researcher v3.6.0：注入的 DeepSeek 端点没有 embeddings API，默认 EMBEDDING 走同一个
 *   OPENAI_BASE_URL 会 404；`gpt_researcher/actions/query_processing.py` 在这个 tag 里还有个
 *   真实上游 bug（`Any`/`List` 在用到之后才 import，模块加载就炸）。都是目标仓库自身的问题，
 *   不是这个 provisioning 钩子能修的。
 * - Vanna v2.0.2：是架构重写，官方好几个示例脚本本身是坏的（`CookieEmailUserResolver` 不存在、
 *   `ToolRegistry.register()`应为`register_local_tool(tool, access_groups=[...])`、
 *   `Agent()` 必须传 `agent_memory`，可用 `vanna.integrations.local.agent_memory.in_memory.
 *   DemoAgentMemory` 走本地内存，不用额外服务）。走通之后 `/api/vanna/v2/chat_poll` 用公开
 *   demo 库 https://vanna.ai/Chinook.sqlite 验证过是好的，正向查询与反幻觉分支都对。
 * - DB-GPT v0.8.1：`[[models.embeddings]]` 默认打 `https://api.openai.com/v1/embeddings`（不是
 *   OPENAI_API_BASE 派生的），拿 DeepSeek key 会 401——但这只影响 db summary 的 RAG 增强，
 *   `chat_data` 走的是直接把 schema 灌进 prompt 这条路，embeddings 缺失只在日志里留一条
 *   warning，SQL 生成本身不受影响，端到端验证过是好的（含反幻觉分支）。三个目标里资源最重
 *   （`uv sync` 是唯一装出 300MB+ 依赖的），其余两个都轻。
 * - `scripts/examples/load_examples.sh` 需要 `sqlite3` CLI（不是 python 自带的 sqlite3 模块），
 *   已经烘焙进 python template。
 *
 * FinRobot（原第四条接入路径）已移除：它的财务数据源打的是 FMP 已下线的 legacy 端点，
 * 上游停摆了近一年没修，不是这个钩子能解决的问题——见 README 里的说明。
 */

import type { SandboxHook } from "niceeval/sandbox";
import { ENV_FILE, loadRepoEnv } from "./env.ts";

/** 目标应用需要的 host 侧变量名 -> 沙箱内要写成的通用变量名（多数 Python 项目认这几个名字）。 */
const REQUIRED_VARS = [
  ["TARGET_APP_OPENAI_API_KEY", "OPENAI_API_KEY"],
  ["TARGET_APP_OPENAI_BASE_URL", "OPENAI_BASE_URL"],
  ["TARGET_APP_MODEL", "TARGET_APP_MODEL"],
] as const;

/** 沙箱内落点：放 workdir 之外，跟 candidate 的道理一样——不算进 agent 的 diff。 */
export const TARGET_APP_ENV_PATH = "/opt/fixture-secrets/target-app.env";

/**
 * 环境钩子：把目标应用要用的 LLM 凭证写成一份沙箱内可读的 env 文件。三条接入路径共用——
 * 给哪些变量是「这次实验的环境」这一层的事，跟具体读哪个宿主仓库无关，所以挂在 sandbox
 * spec 上（见 experiments/shared.ts 的 `.setup()` 链）。Python 工具链不在这里装，见上面
 * 文件头注释。
 */
export function provisionTargetAppEnv(): SandboxHook {
  return async (sandbox, ctx) => {
    loadRepoEnv();
    for (const [hostVar] of REQUIRED_VARS) {
      if (!process.env[hostVar]) {
        throw new Error(`${ENV_FILE} 里缺 ${hostVar}，目标应用没有可用的 LLM 凭证。`);
      }
    }

    ctx.progress({ message: "注入目标应用 LLM 凭证" });
    const lines = REQUIRED_VARS.map(([hostVar, sandboxVar]) => `${sandboxVar}=${process.env[hostVar] ?? ""}`).join(
      "\n",
    );
    await sandbox.uploadFiles([{ path: TARGET_APP_ENV_PATH, content: `${lines}\n` }]);

    const check = await sandbox.runCommand("test", ["-s", TARGET_APP_ENV_PATH]);
    if (check.exitCode !== 0) {
      throw new Error(`目标应用凭证写入后不可读：${TARGET_APP_ENV_PATH}`);
    }
  };
}
