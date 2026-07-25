/**
 * 评估exp质量（软分，不 gate）：装对了之后写得讲不讲究——至少两格实验（baseline + 对比）、
 * 按 compare-models 组织、每格 runs=1、不为一两个实验先抽 shared.ts。品味红了东西还是能用
 * 的，不 gate。
 *
 * 之后再叠一层「评估exp质量最佳实践」（纯加分）：每个实验文件内部的写法——都写了 description、
 * 对比组各钉一个不同的 model、静态配置经 adapter 工厂在实验文件里传。两层的区别是「这组实验
 * 作为一次运行成不成立」与「每个文件写得像不像文档教的样子」。
 *
 * 与 evalInstall（见 ./eval-install.ts）一样被 install 下五条接入路径 eval 共用。
 *
 * 写法约定：判定一律用官方断言词汇，不发明领域 API；取证一律「一条命令或一个文件」——
 * 探针只取证不判定，判定是紧跟着的一条 t.check 配 matcher。
 */

import type { ScoreTestContext } from "niceeval";
import { isTrue, satisfies } from "niceeval/expect";
import { locateInstallRoot, parseExpPlanDocument, type ExpPlanDocument } from "./eval-install.ts";
import { readAgentFiles, splitAgentFiles } from "./fixture.ts";

/** 评估exp质量（软分，不 gate）：装对了之后写得讲不讲究。 */
export async function evalExperiment(t: ScoreTestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // --dry --json 输出单个 ExpPlanDocument（见 eval-install.ts 的 parseExpPlanDocument）；
  // stderr 分流到 /dev/null，stdout 上只留纯净 JSON。
  const dry = await sandbox.runShell(`npx --no-install niceeval exp --dry --json 2>/dev/null`, { cwd: at });
  const dryPlan = parseExpPlanDocument(dry.stdout);
  const shared = (
    await sandbox.runShell(`find experiments agents adapters -maxdepth 2 -iname 'shared*.ts' 2>/dev/null`, {
      cwd: at,
    })
  ).stdout.trim();

  // satisfies() 的 predicate 参数类型固定是 unknown（见 niceeval/expect），这里在断言体内
  // 一次性收窄回 ExpPlanDocument | null，三条判据共用同一份收窄结果。
  const asPlan = (v: unknown) => v as ExpPlanDocument | null;

  await t.group("评估exp质量", async () => {
    // 一格实验什么也比不了：baseline 之外至少还要有一个对比格。宿主接口完全不支持
    // 任何变体时允许退化，所以是软分不 gate。
    t.check(
      dryPlan,
      satisfies((v) => (asPlan(v)?.matrix.length ?? 0) >= 2, "至少两格实验配置——baseline 加至少一个对比").atLeast(
        1,
      ),
    );
    // compare-models 是 INIT.md 明确要求的默认组织方式
    t.check(
      dryPlan,
      satisfies(
        (v) => (asPlan(v)?.matrix ?? []).some((row) => row.experimentId.includes("compare-models/")),
        "按 compare-models 实验组组织",
      ).atLeast(1),
    );
    // 接入期每格 runs=1：先跑通一次再谈统计，多 runs 只是烧时间和预算。ExpPlanDocument.runs
    // 是这次 --dry 选中范围内统一适用的每格 runs 数（total = matrix 行数 × runs）。
    t.check(dryPlan, satisfies((v) => asPlan(v)?.runs === 1, "每格实验 runs=1").atLeast(1));
    // 一两个实验不配抽象层：shared.ts 是文档里给「实验多了以后」的写法，起手就抽是过度设计
    t.check(shared.length === 0, isTrue(`没有先抽 shared.ts 共享抽象（实际：${shared || "无"}）`).atLeast(1));
  });

  // ── 最佳实践（纯加分，每条 1 分）：实验文件写没写成文档教的样子。 ────────────────────
  // 上面四条判的是「这组实验作为一次运行成不成立」（几格、怎么组织、跑几次），这里判的是
  // 每个实验文件内部的写法——判据来自 write-experiment.mdx（一个文件一格配置、静态配置进
  // adapter 工厂、模型对比各钉一个 model）与从零接入页的收尾自检（没有没人读的死配置）。
  const experiments = await readAgentFiles(
    sandbox,
    at,
    `grep -rl 'defineExperiment' --include='*.ts' . --exclude-dir=node_modules`,
  );
  const files = splitAgentFiles(experiments);
  // model 的字面值去重：模型对比要求两个实验文件各钉一个**不同**的 model，写成同一个值的
  // 两格比不出任何东西。只数字面量——`model: someVar` 这种变量形态数不到，宁可少给一分。
  const models = new Set(Array.from(experiments.matchAll(/model:\s*["'`]([^"'`]+)["'`]/g), (m) => m[1]));

  await t.group("评估exp质量最佳实践", async () => {
    // 每个实验文件都写 description：报告与 CLI 的对比表按它认人，缺了只剩一个路径 id。
    t.check(
      files,
      satisfies(
        (v) => (v as string[]).length > 0 && (v as string[]).every((f) => /\bdescription:/.test(f)),
        `每个实验文件都写了 description（实际取到 ${files.length} 个实验文件）`,
      ),
    ).points(1);

    // 模型对比的实质：两格各钉一个不同的 model。宿主只有一个可用模型时挣不到，属于
    // 「这次接入没走到那一档」，所以纯加分。
    t.check(
      models.size >= 2,
      isTrue(`对比组里至少两个不同的 model 值（实际：${[...models].join(" / ") || "无"}）`),
    ).points(1);

    // 「静态配置走 adapter 工厂」的实验侧一半：agent 字段是工厂调用、URL / 鉴权在这里传，
    // 换环境只改这一行。adapter 侧那一半在 ./eval-adapter.ts 的 evalAdapterPractice 里判。
    t.check(
      experiments,
      satisfies(
        (v) => /agent:\s*[A-Za-z_$][\w$]*\s*\(/.test(v as string),
        "agent 字段是配置好的工厂调用（静态配置在实验文件里传，不写死在 adapter 里）",
      ),
    ).points(1);
  });
}
