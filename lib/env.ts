/**
 * 仓库根 `.env`（已加入 .gitignore）的单一加载入口。
 *
 * 装的是两类互不相关的宿主侧凭证，都读同一个文件：
 *   - niceeval 自己要用的（CODEX_API_KEY/CODEX_BASE_URL 给被测 codexAgent()，
 *     judge.apiKeyEnv 也指回 CODEX_API_KEY，见 niceeval.config.ts）；
 *   - 目标应用要用的 TARGET_APP_*（见 lib/fixture-env.ts，只在 sandbox.setup 钩子里读）。
 * 只加载一次；缺文件不算错——非 install 相关的命令（如 `niceeval list`）不依赖它。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const ENV_FILE = resolve(import.meta.dirname, "../.env");

let loaded = false;

export function loadRepoEnv(): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
  }
}
