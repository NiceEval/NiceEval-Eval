/**
 * 评估exp质量（软分，不 gate）：装对了之后写得讲不讲究——至少两格实验（baseline + 对比）、
 * 按 compare-models 组织、每格 runs=1、不为一两个实验先抽 shared.ts。品味红了东西还是能用
 * 的，不 gate。
 *
 * 与 evalInstall（见 ./eval-install.ts）一样被 install 与 undo 两组接入路径 eval 共用。
 *
 * 写法约定：判定一律用官方断言词汇，不发明领域 API；取证一律「一条命令或一个文件」——
 * 探针只取证不判定，判定是紧跟着的一条 t.check 配 matcher。
 */

import type { TestContext } from "niceeval";
import { isTrue, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./eval-install.ts";

/** 评估exp质量（软分，不 gate）：装对了之后写得讲不讲究。 */
export async function evalExperiment(t: TestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  const dry = await sandbox.runShell(`npx --no-install niceeval exp --dry --output ci 2>&1`, { cwd: at });
  const shared = (
    await sandbox.runShell(`find experiments agents adapters -maxdepth 2 -iname 'shared*.ts' 2>/dev/null`, {
      cwd: at,
    })
  ).stdout.trim();

  await t.group("评估exp质量", async () => {
    // 一格实验什么也比不了：baseline 之外至少还要有一个对比格。宿主接口完全不支持
    // 任何变体时允许退化，所以是软分不 gate。
    t.check(
      dry.stdout,
      satisfies(
        (s) => ((s as string).match(/^niceeval: plan-row /gm)?.length ?? 0) >= 2,
        "至少两格实验配置——baseline 加至少一个对比",
      ).atLeast(1),
    );
    // compare-models 是 INIT.md 明确要求的默认组织方式
    t.check(
      dry.stdout,
      satisfies(
        (s) => /experiment="?[^"\s]*\bcompare-models\//.test(s as string),
        "按 compare-models 实验组组织",
      ).atLeast(1),
    );
    // 接入期每格 runs=1：先跑通一次再谈统计，多 runs 只是烧时间和预算
    t.check(
      dry.stdout,
      satisfies((s) => !/\bruns=(?!1\b)\d+/.test(s as string), "每格实验 runs=1").atLeast(1),
    );
    // 一两个实验不配抽象层：shared.ts 是文档里给「实验多了以后」的写法，起手就抽是过度设计
    t.check(shared.length === 0, isTrue(`没有先抽 shared.ts 共享抽象（实际：${shared || "无"}）`).atLeast(1));
  });
}
