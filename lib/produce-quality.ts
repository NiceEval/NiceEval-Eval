/**
 * install eval 的共用件：能动性层（真跑过一次吗）与产出质量层（分维度 judge）。
 *
 * ⚠️ 本文件写给「niceeval 应有的 API」，不是现有 API——`niceeval/project` 还不存在，
 * typecheck 的红是有意留下的：每个红点都是要在 niceeval 落地的规格，落地后这里一行不改。
 *
 * `openProject(sandbox)` 的规格（提给 niceeval 的 API 提案）：
 *
 *   const project = await openProject(sandbox);
 *   // 在 workspace 里发现 niceeval 安装（找 niceeval.config.ts，不假设在 workdir 根：
 *   // python 宿主就地新建子目录装是正确做法）；没有安装则返回 null。
 *
 *   project.root
 *   // 安装根，相对 workdir。
 *
 *   await project.sources.asJudgeMaterial()
 *   // 按 experiment / eval / adapter 分节标注、可直接喂 judge 的三件套源码材料。
 *   // 分类按 niceeval 自己的项目发现（config 引用、evals/experiments 发现机制），
 *   // 不是按路径正则猜。契约来自真实产出栽过的两个坑：① 必须含 adapter——
 *   // 「传输方式对不对」（进程内直调 / spawn 被测进程 / 真发请求）只在 adapter 里
 *   // 看得见；② 不靠 ignoreDirs 剪宿主目录来挑——agent 常把 niceeval 装进宿主
 *   // 前端工程（如 DB-GPT 的 web/），剪掉等于把 agent 自己的产出也剪没。
 *
 *   await project.results()
 *   // niceeval/results 的 openResults 对沙箱安装打开：同形状的「实验 → 快照 →
 *   // eval → attempt」类型化层次，events() 等重 artifact 懒加载、缺失返回 null。
 */

import type { TestContext } from "niceeval";
import { isTrue, satisfies } from "niceeval/expect";
import { openProject } from "niceeval/project";

/** 一个产出质量维度：一句可证伪的判据 + 阈值 + 报告里显示的维度名。 */
export interface QualityDimension {
  key: string;
  threshold: number;
  criteria: string;
}

/**
 * 产出质量层：把一条二值 closedQA 拆成多条各自可证伪的分维度 judge，分数因此是分维度的
 * （更高级），且能直接倒查是哪一维塌了。judge 是软分（severity=soft），不 gate verdict。
 *
 * 每个维度各自套一层以维度命名的 group：judge 断言名固定是 judge:autoevals:closedQA，
 * 五条挤在一起无法区分，套上后 report 里成了「产出质量层 · 传输保真 · …」，一眼可查。
 */
export async function runQualityDimensions(
  t: TestContext,
  dimensions: readonly QualityDimension[],
): Promise<void> {
  const project = await openProject(t.sandbox);
  const material = project ? await project.sources.asJudgeMaterial() : "（未发现 niceeval 安装）";
  await t.group("产出质量层", async () => {
    for (const d of dimensions) {
      await t.group(d.key, async () => {
        t.judge.autoevals.closedQA(d.criteria, { on: material }).atLeast(d.threshold);
      });
    }
  });
}

/**
 * 能动性层（软分，不 gate）：agent 有没有真把自己写的东西跑起来、真联上被测系统——
 * 内层有 attempt 落盘、至少一个 attempt 完成判定、niceeval show 能读出结果。
 *
 * 联没联上不用自己数事件：内层 runner 早就裁过了——send 连不上会让 attempt 进 errored
 * （result.error 带结构化错误码），能完成判定（passed / failed 都算）就说明请求真发出去、
 * 回应真回来了。agent 自评能糊弄的是「回应好不好」（一句 t.succeeded() 的弱断言），
 * 那归产出质量层的 judge 管，不在这层重复判。
 * 起被测系统很重且波动大（见 lib/fixture-env.ts），所以只作软分计量、不 gate；红了靠
 * diagnostic 里的结构化错误码倒查是「没起服务」还是「adapter 写错」。
 *
 * @param systemName 被测系统名（如 "DB-GPT" / "GPT Researcher"），只用于断言/诊断文案。
 */
export async function assertAdapterRanLive(t: TestContext, systemName: string): Promise<void> {
  const project = await openProject(t.sandbox);
  const results = project ? await project.results() : null;

  const attempts = [];
  for (const exp of results?.experiments ?? []) {
    for (const snap of exp.snapshots) attempts.push(...snap.attempts);
  }

  let adjudicated = 0;
  const errors: string[] = [];
  for (const attempt of attempts) {
    const err = attempt.result.error;
    if (err) errors.push(String(err.code ?? err.message ?? "unknown"));
    else adjudicated++;
  }
  const dyn = { ranResults: attempts.length, adjudicated, errored: errors.length };

  // agent 自己装的那个 CLI 能不能把跑出来的结果显示出来（niceeval show 看得到内容）。
  const show = await t.sandbox.runShell(`npx --no-install niceeval show --output ci 2>&1`, {
    cwd: project?.root ?? ".",
  });
  const showSawContent =
    show.exitCode === 0 && /\b(passed|failed|errored)\b|@[a-z0-9]{6,}/i.test(show.stdout);

  await t.group("能动性层", async () => {
    t.check(
      dyn.ranResults,
      satisfies((n) => (n as number) >= 1, "agent 真的把 eval 跑起来过（内层有 attempt 落盘）").atLeast(1),
    );
    t.check(
      dyn.adjudicated,
      satisfies(
        (n) => (n as number) >= 1,
        `adapter 真的联上过 ${systemName}：至少一个 attempt 完成判定` +
          `（完成 ${dyn.adjudicated}，errored ${dyn.errored}）`,
      ).atLeast(1),
    );
    t.check(showSawContent, isTrue("niceeval show 能显示出跑过的结果内容").atLeast(1));
  });

  // 一个完成判定的 attempt 都没有时留一条永久记录，供按结构化错误码倒查。
  if (dyn.adjudicated < 1) {
    t.diagnostic({
      code: "adapter-no-live-response",
      level: "warning",
      message:
        `内层 run 没有一个完成判定的 attempt（共 ${dyn.ranResults} 份落盘，` +
        `errored：${errors.join(", ") || "无"}）。错误码是连接类多半是没起服务；` +
        `一份落盘都没有则是压根没跑。`,
      data: { ...dyn, errors },
    });
  }
}
