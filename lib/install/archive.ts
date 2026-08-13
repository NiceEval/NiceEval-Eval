/**
 * 生命周期收尾：把这次 attempt 里 agent 写出的三件套（evals / experiments / adapter /
 * niceeval.config.ts）从沙箱 copy 到仓库根 `.agent-output/`（已 gitignore）下，保留原相对
 * 路径，方便事后人工 review「AI 到底写得怎么样、adapter 写得对不对」。沙箱销毁后这些产物就
 * 没了，所以趁 test() 收尾时抓一份落到本地。
 *
 * 为什么做成「eval 收尾时调一次的 helper」而不是 sandbox `.teardown()` 钩子：teardown 的
 * SandboxHookContext 只给得到 experimentId，给不到「这次跑的是哪个被测目标（db-gpt /
 * gpt-researcher / vanna）」——而 review 最需要的恰恰是按目标归档。TestContext 也不直接暴露
 * eval id，所以由各 eval 把自己的目标名显式传进来，命名才准。
 *
 * 纯落盘、不断言、不影响 verdict；任何失败都吞掉（review 辅助设施不该拖垮一条 eval）。
 *
 * 这是安装套件的复盘基础设施；Harness 不消费它。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScoreTestContext } from "niceeval";
import { locateInstallRoot } from "./installation.ts";

/** 归档根目录：仓库根下的 .agent-output（.gitignore 已忽略）。 */
export const AGENT_OUTPUT_DIR = resolve(import.meta.dirname, "../../.agent-output");

/** 供 review 用的目录名安全化：只留 词字符 / 点 / 连字符。 */
function slug(s: string): string {
  return s.replace(/[^\w.-]+/g, "_");
}

/**
 * 把 agent 在沙箱里写出的三件套归档到本地，返回落盘目录（没装成 / 一件都没抓到则返回 undefined）。
 *
 * 命名：`.agent-output/<candidateVersion>/<target>/<ISO时间>__<model>/<原相对路径>`
 * —— 按候选版本 + 被测目标 + 时间戳分区，同一目标多次跑不互相覆盖，便于横向对比。
 *
 * @param target 被测目标名（如 "db-gpt"），由调用它的 eval 传入。
 */
export async function archiveAgentOutput(t: ScoreTestContext, target: string): Promise<string | undefined> {
  try {
    // 只下 install root 下的三件套，不下整个 root：DB-GPT 这类装在仓库根（at="."）的宿主，
    // 整下会把整个被测仓库拖进归档。缺哪件下哪件报错就跳过（不是每个 agent 都写全）。
    const at = await locateInstallRoot(t.sandbox);
    if (at === null) return undefined; // 没装成，无三件套可归
    const prefix = at === "." ? "" : `${at}/`;

    const version = slug(String(t.flags.candidateVersion ?? "unknown"));
    const model = slug(t.model ?? "model");
    // Date 在普通 eval 进程里可用（受限的是 Workflow 脚本，不是这里）。冒号/点换成连字符，
    // 让目录名在所有文件系统上都合法且可按时间排序。
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const root = resolve(AGENT_OUTPUT_DIR, version, slug(target), `${stamp}__${model}`);
    mkdirSync(root, { recursive: true });

    let got = false;
    // eval / experiment / adapter 三类各是 install root 下的一个目录：downloadDirectory 逐个原样
    // 搬运。adapter 目录既可能叫 agents 也可能叫 adapters，都试。
    for (const dir of ["evals", "experiments", "agents", "adapters"]) {
      await t.sandbox
        .downloadDirectory(`${prefix}${dir}`, resolve(root, dir))
        .then(() => (got = true))
        .catch(() => {}); // 该目录不存在就跳过
    }
    // niceeval.config.ts 是 install root 上的单文件，downloadDirectory 下不了，单取。
    const cfg = await t.sandbox
      .downloadFile(`${prefix}niceeval.config.ts`, resolve(root, "niceeval.config.ts"))
      .then(() => true)
      .catch(() => false);
    if (cfg) {
      got = true;
    }
    if (!got) return undefined;

    writeFileSync(
      resolve(root, "_meta.txt"),
      [
        `target=${target}`,
        `candidateVersion=${version}`,
        `model=${model}`,
        "",
      ].join("\n"),
    );

    t.log(`agent 产出已归档到 ${root}`);
    return root;
  } catch (e) {
    t.log(`归档 agent 产出失败（已忽略）：${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
