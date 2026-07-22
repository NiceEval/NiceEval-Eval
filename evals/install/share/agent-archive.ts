/**
 * 生命周期收尾：把这次 attempt 里 agent 写出的三件套（experiment / eval / adapter / config）
 * 从沙箱 copy 到仓库根 `.agent-output/`（已 gitignore）下，保留原相对路径，方便事后人工
 * review「AI 到底写得怎么样、adapter 写得对不对」。沙箱销毁后这些产物就没了，所以趁 test()
 * 收尾时抓一份落到本地。
 *
 * 为什么做成「eval 收尾时调一次的 helper」而不是 sandbox `.teardown()` 钩子：teardown 的
 * SandboxHookContext 只给得到 experimentId，给不到「这次跑的是哪个被测目标（db-gpt /
 * gpt-researcher / vanna）」——而 review 最需要的恰恰是按目标归档。TestContext 也不直接暴露
 * eval id，所以由各 eval 把自己的目标名显式传进来，命名才准。
 *
 * 纯落盘、不断言、不影响 verdict；任何失败都吞掉（review 辅助设施不该拖垮一条 eval）。
 *
 * 放在 evals/install/share/ 而不是顶层 lib/:只有 install 这组接入路径 eval 需要按「三件套」
 * 归档产出复盘，undo / debug 两组都用不上。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { TestContext } from "niceeval";
import { locateInstallRoot } from "./eval-install.ts";
import { DEFAULT_SOURCE_IGNORE_DIRS } from "./fixture.ts";

/** 归档根目录：仓库根下的 .agent-output（.gitignore 已忽略）。 */
export const AGENT_OUTPUT_DIR = resolve(import.meta.dirname, "../../../.agent-output");

// 与 db-gpt.eval.ts 产出质量层同一套「哪些是 agent 手写三件套」的路径判定。
const isEval = (p: string) => /\.eval\.ts$/.test(p);
const isExperiment = (p: string) => /(^|\/)experiments\//.test(p);
const isAdapter = (p: string) => /(^|\/)(agents?|adapters?)\//.test(p);
const isConfig = (p: string) => /(^|\/)niceeval\.config\.ts$/.test(p);

/** 供 review 用的目录名安全化：只留 词字符 / 点 / 连字符。 */
function slug(s: string): string {
  return s.replace(/[^\w.-]+/g, "_");
}

/**
 * 把 agent 在沙箱里写出的三件套归档到本地，返回落盘目录（没抓到任何文件则返回 undefined）。
 *
 * 命名：`.agent-output/<candidateVersion>/<target>/<ISO时间>__<model>/<原相对路径>`
 * —— 按候选版本 + 被测目标 + 时间戳分区，同一目标多次跑不互相覆盖，便于横向对比。
 *
 * @param target 被测目标名（如 "db-gpt"），由调用它的 eval 传入。
 */
export async function saveAgentOutput(t: TestContext, target: string): Promise<string | undefined> {
  let staging: string | undefined;
  try {
    // niceeval 的 sandbox 不设按扩展名过滤的批量读取器——downloadDirectory 是唯一的批量
    // 取回 API，原样搬运、不过滤，先落进一个临时目录，三件套的归属判定在本地做。
    staging = await mkdtemp(join(tmpdir(), "niceeval-agent-output-"));
    const at = (await locateInstallRoot(t.sandbox)) ?? ".";
    await t.sandbox.downloadDirectory(staging, at, { ignore: DEFAULT_SOURCE_IGNORE_DIRS });

    const tsPaths = (await readdir(staging, { recursive: true })).filter((p) => p.endsWith(".ts"));
    const picked = tsPaths.filter((p) => isEval(p) || isExperiment(p) || isAdapter(p) || isConfig(p));
    if (picked.length === 0) return undefined;

    const version = slug(String(t.flags.candidateVersion ?? "unknown"));
    const model = slug(t.model ?? "model");
    // Date 在普通 eval 进程里可用（受限的是 Workflow 脚本，不是这里）。冒号/点换成连字符，
    // 让目录名在所有文件系统上都合法且可按时间排序。
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const root = resolve(AGENT_OUTPUT_DIR, version, slug(target), `${stamp}__${model}`);

    for (const p of picked) {
      const dst = resolve(root, p);
      mkdirSync(dirname(dst), { recursive: true });
      await copyFile(join(staging, p), dst);
    }
    writeFileSync(
      resolve(root, "_meta.txt"),
      [
        `target=${target}`,
        `candidateVersion=${version}`,
        `model=${model}`,
        `sandboxId=${t.sandbox.sandboxId}`,
        `files:`,
        ...picked.map((p) => `  ${p}`),
        "",
      ].join("\n"),
    );

    t.log(`agent 产出已归档到 ${root}`);
    return root;
  } catch (e) {
    t.log(`归档 agent 产出失败（已忽略）：${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
