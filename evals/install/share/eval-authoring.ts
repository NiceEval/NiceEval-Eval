/**
 * 评估eval写法最佳实践（纯加分，每条 1 分）：agent 写出来的 `.eval.ts` 用没用文档教的那套词汇。
 *
 * 与产出质量层（见 ./quality-criteria.ts）的分工，跟 evalAdapterPractice 与 evalAdapter 的
 * 分工同源——**judge 判语义、机器判存在性**：
 *
 * - 那边四维判「这条 eval 作为评估成不成立」：输入贴不贴核心用例、断言会不会在胡编时变红、
 *   有没有负例、实验与 eval 是不是同一个被测系统。这些 grep 不动，只能读代码判。
 * - 这里三条判「有没有用官方的那套东西」：断言词汇是不是 `t.*` + `niceeval/expect` 的
 *   matcher、有没有留一条经得起措辞变化的语义/形状判定、有没有在 eval 里代管被测进程。
 *   全是存在性事实，机器验得了的就不发给 judge。
 *
 * 判据来源逐条对应候选自己发的文档：
 * 1. authoring.mdx / scoring-guide.mdx——驱动与断言都走 `t` 的官方词汇，不是自己 throw；
 * 2. 从零接入页第 3 步：措辞开放的回答要用 `t.judge` 或形状断言（`includesUrl()` /
 *    `hasSections()`），没 key 时就降级到形状断言，不要拿单一精确短语去卡；
 * 3. 从零接入页的架构硬规则之二：「评估用例侧不代管被测进程」——不 spawn 应用、不另开端口，
 *    应用由用户按平时的方式启动，adapter 连不上就报「先起应用」。
 *
 * 六条接入路径都调（sandbox 路径也写 eval，这三条对它一样成立）。全部 `.points(1)` 纯加分，
 * 没有一条是 gate。
 *
 * 写法约定同各 eval-*.ts 头注：探针只取证（一条命令），判定紧跟一条 t.check 配 matcher。
 */

import type { ScoreTestContext } from "niceeval";
import { satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./eval-install.ts";
import { readAgentFiles } from "./fixture.ts";

/** 评估eval写法最佳实践（纯加分）：见文件头注。 */
export async function evalAuthoringPractice(t: ScoreTestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // 一条命令取回 agent 写的评估用例：按 `.eval.ts` 认人——runner 也只发现这个后缀，
  // 名字不对的文件根本进不了运行，不该在这层给分。
  const source = await readAgentFiles(
    sandbox,
    at,
    `find . -name '*.eval.ts' -not -path './node_modules/*'`,
  );
  // satisfies() 的 predicate 参数固定收 unknown（见 niceeval/expect），三条判据共用这个收窄。
  const src = (v: unknown) => v as string;

  await t.group("评估eval写法最佳实践", async () => {
    // 官方断言词汇：驱动走 t.send / t.respond，判定走 t.check + niceeval/expect 的 matcher
    // （或 t.succeeded / t.calledTool 这类作用域断言）。自己 if + throw 也能让 attempt 变红，
    // 但那样断言不进结果、报告里看不到逐条明细，`niceeval show` 也无从下钻。
    t.check(
      source,
      satisfies(
        (s) =>
          /from\s+["']niceeval\/expect["']/.test(src(s)) &&
          /\bt\.(check|succeeded|calledTool|messageIncludes|judge)\b/.test(src(s)),
        "断言用官方词汇（t.check / 作用域断言 + niceeval/expect 的 matcher），不是自己 throw",
      ),
    ).points(1);

    // 措辞开放的回答要留一条经得起换措辞的判定，文档给的三条路子都算数：t.judge 的语义评分、
    // 形状断言（includesUrl / hasSections / matches / similarity），以及**多措辞等价的正则**
    // ——`includes(/no reliable sources|cannot find|does not exist/i)` 就是它，2026-07-25 首跑
    // 里 gpt-researcher 两格的负例正是这么写的，漏掉它会把一个正确写法判成 N。
    // 判 N 的是全篇只有精确字符串 includes 的 eval：换个说法就误判。
    t.check(
      source,
      satisfies(
        (s) =>
          /\bt\.judge\b|\bincludesUrl\s*\(|\bhasSections\s*\(|\bmatches\s*\(|\bsimilarity\s*\(/.test(src(s)) ||
          /\b(includes|excludes)\s*\(\s*\//.test(src(s)),
        "留了经得起措辞变化的判定（t.judge 语义评分、includesUrl / hasSections 这类形状断言，或多措辞等价的正则）",
      ),
    ).points(1);

    // 评估用例侧不代管被测进程。注意本仓的罐头答复里有「被测服务需要的话你自己起」——那句
    // 说的是 agent 自己在 shell 里把服务拉起来（合理），不是把 spawn 写进 eval 文件里
    // （每个 attempt 各起一份、端口打架、收不干净）。这条判的只有后者。
    t.check(
      source,
      satisfies(
        (s) =>
          src(s).length > 0 &&
          !/child_process|\bexeca\b|\bspawn(Sync)?\s*\(|\bexecSync\s*\(|docker\s+(run|compose)/.test(src(s)),
        "评估用例里没有代管被测进程（不 spawn 应用 / 不另开端口，起服务不是 eval 的事）",
      ),
    ).points(1);
  });
}
