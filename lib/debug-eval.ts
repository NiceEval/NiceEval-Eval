/**
 * debug eval 的公共骨架：在一个已经跑出结果的项目里，替用户查一条指定信息。
 *
 * 与 install eval 的根本区别：那边评「从零接入」，这边评「接入之后的日常」——
 * fixture 是只读的真实结果数据，题库的标准答案在出题时由人工核对并随 fixture 签入。
 * 数据不重跑、答案不腐烂，所以这组评估可以反复回归 CLI 的输出改版。
 */

import { defineEval } from "niceeval";
import { includes, isFalse, isTrue } from "niceeval/expect";
import { assertPagesInCandidate } from "./candidate.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "./routing.ts";
import type { StreamEvent } from "niceeval";

/** 题型。按钻取深度分层，每层对应 CLI 链路的一段。 */
export type QuestionKind =
  | "overview" // 总览题：show 首屏与警告文案的可执行性
  | "compare" // 横向对比题：show --exp 的对比视图
  | "locate" // 多跳定位题：show → --exp → attempt 行
  | "dig" // 深挖题：show @<attempt> --execution 的 transcript
  | "boundary"; // 边界题：数据里不存在的信息，标准答案是「查不到」

export interface DebugQuestion {
  /** 稳定 id，进 eval id，改题面时不要改它 */
  id: string;
  kind: QuestionKind;
  /** 发给 agent 的自然语言查询 */
  question: string;
  /**
   * 标准答案的关键事实点：attempt id、断言名、退出码、数字、API 名等。
   * 全部必须出现在回答里。出题时人工从签入数据核对。
   */
  expectedFacts?: string[];
  /**
   * 重跑类问题的标准答案是命令文本本身——fixture 只读，不实际执行。
   */
  expectedCommand?: string;
  /**
   * 边界题标记：数据里查不到这条信息，正确行为是如实说查不到。
   * 这类题不给 expectedFacts，改判「有没有编造」。
   */
  unanswerable?: boolean;
  /** 合格的文档落点，任意一页命中即算路由正确 */
  expectedPages?: string[];
}

/** 默认落点：查结果类任务应该落到「查看结果」或「排查失败」这两页 */
const DEFAULT_PAGES = [
  "docs-site/zh/how-to/viewing-results.mdx",
  "docs-site/zh/troubleshooting/debugging.mdx",
  "docs-site/zh/reference/cli.mdx",
];

/**
 * 路径层：诊断是不是沿 CLI 钻取链完成的。
 *
 * 徒手翻 .niceeval 原始 JSON 不判失败——答案对了就是对了。但它单独计量，
 * 因为它是「CLI 视图信息不足或不可发现」最直接的信号：agent 绕开 CLI，
 * 通常不是因为它想，而是因为 CLI 没让它找到那条路。
 */
export function usedCliChain(events: readonly StreamEvent[]): boolean {
  const haystack = events.map((e) => JSON.stringify(e)).join("\n");
  return /niceeval\s+show/.test(haystack);
}

export function readRawJson(events: readonly StreamEvent[]): boolean {
  const haystack = events.map((e) => JSON.stringify(e)).join("\n");
  // 读 .niceeval 下的原始产物：events.json / trace.json / result.json
  return /\.niceeval\/[\w./-]*\.json/.test(haystack);
}

export interface DebugFixtureSpec {
  /** fixture 目录（相对 eval 文件），含最小宿主配置 + 整目录签入的 .niceeval */
  fixtureDir: string;
}

export function defineDebugEval(spec: DebugFixtureSpec, q: DebugQuestion) {
  return defineEval({
    description: `[${q.kind}] ${q.question}`,
    tags: ["debug", q.kind],
    async test(t) {
      const version = t.flags.candidateVersion as string;

      // 合格落点必须在这个候选里真实存在，否则路由层只会静默读零（见 assertPagesInCandidate）
      assertPagesInCandidate(q.expectedPages ?? DEFAULT_PAGES, version);

      // fixture 只读：数据永不重跑，agent 只做探查
      await t.sandbox.uploadDirectory(spec.fixtureDir);

      // 装候选版本，覆盖 fixture package.json 里那行 `niceeval: ^0.8.0`。
      //
      // 那行是导出时从源项目原样抄来的，照它装会从 npm 拉一个跟候选无关的版本，
      // 路由层就会去量那个版本的随包文档——对照组的前提当场作废。签入的 fixture
      // 保持「真实项目切片」不动，钉版本的责任在 harness 这边，所以在沙箱里覆盖装，
      // 而不是改 fixture（改了下次 export-debug-fixture.ts 也会冲掉）。
      //
      // 这步跑在第一次 t.send() 之前，属于 eval 归因，不会进 agent diff，
      // 所以下面路径层那条 diff.isEmpty() 不受影响。
      const install = await t.sandbox.runCommand("pnpm", ["add", "-D", `niceeval@${version}`]);
      if (install.exitCode !== 0) {
        throw new Error(
          `候选包装不上，后面每一步失败都会被误判成 agent 不会查：\n${install.stderr || install.stdout}`,
        );
      }

      // ── 唯一的自变量：AGENTS.md 里有没有 init 写的托管区块 ──────────────
      //
      // 随包文档物理上没法从沙箱里摘掉（它是包的一部分），但**通往它的指针**可以。
      // `niceeval init` 会在 AGENTS.md 写一段托管区块，内容是「niceeval 不在你的训练
      // 数据里，先读 node_modules/niceeval/INDEX.md」——这段就是 agent-docs 机制赖以
      // 起作用的入口。有它 / 没它，才是能被强制隔离的真实差异。
      //
      // 不用任务指令写「本次限制：只能用 --help」那种约束：那是「要求配合」，agent
      // 听不听全凭自觉，量出来的差值混着服从度。这里改成结构性差异，两组的题面完全相同。
      //
      // 区块内容是候选自己 src/cli.ts 里的常量，各版本不同，所以必须由候选的 init
      // 现写，不能由 harness 抄一份——抄了就永远停在抄的那个版本。
      const withAgentRules = t.flags.agentRules !== false;
      if (withAgentRules) {
        const init = await t.sandbox.runCommand("pnpm", ["exec", "niceeval", "init"]);
        if (init.exitCode !== 0) {
          throw new Error(`niceeval init 没跑成，实验组的自变量就没立起来：\n${init.stderr || init.stdout}`);
        }
      }

      // 两组题面完全一致，差异只在上面那段区块在不在
      const turn = await t.send(
        `这个项目已经用 niceeval 跑过评估，结果数据都在 .niceeval 里。

请回答：${q.question}

只查信息，不要修改任何文件，也不要重新运行任何实验。查不到就直说查不到。`,
      );

      // ── 答案层 ──────────────────────────────────────────────
      await t.group("答案层", async () => {
        if (q.unanswerable) {
          // 边界题只有一个考点：抵不抵得住幻觉
          t.judge.autoevals
            .closedQA(
              `这个回答是否如实表示「在现有数据里查不到这条信息」，而不是编造了一个具体答案？
合格：明确说明数据里没有这条信息，或说明无法确定。
不合格：给出了具体的 attempt id、数字、名称等看起来确凿的答案。`,
              { on: t.reply },
            )
            .atLeast(0.8)
            .gate();
        } else {
          for (const fact of q.expectedFacts ?? []) {
            t.check(t.reply, includes(fact).gate());
          }
          if (q.expectedCommand) {
            t.check(t.reply, includes(q.expectedCommand).gate());
          }
        }
      });

      // ── 路径层（计量，不 gate）──────────────────────────────
      await t.group("路径层", async () => {
        t.check(usedCliChain(t.events), isTrue("经由 niceeval show 钻取链完成").atLeast(1));
        t.check(readRawJson(t.events), isFalse("没有徒手翻 .niceeval 原始 JSON").atLeast(1));
        // fixture 只读，改了文件说明它没听懂任务边界
        t.check(t.sandbox.diff.isEmpty(), isTrue("没有改动 fixture 里的任何文件").atLeast(1));
      });

      // ── 路由层（计量，不 gate）──────────────────────────────
      const touched = bundledPagesTouched(t.events);
      const pages = q.expectedPages ?? DEFAULT_PAGES;

      await t.group("路由层", async () => {
        t.check(
          touchedIndex(t.events),
          isTrue(`以随包 INDEX.md 为路由入口（实际读到：${touched.join(", ") || "无"}）`).atLeast(1),
        );
        t.check(
          routedTo(t.events, pages),
          isTrue(`读到与查询任务匹配的页面（期望其一：${pages.join(" | ")}）`).atLeast(1),
        );
        t.check(fellBackToOnlineDocs(t.events), isFalse("没有退回官网 / GitHub main").atLeast(1));
      });

      // 绕开 CLI 徒手翻 JSON 不判失败，但必须留痕：它是「CLI 钻取链不可发现」
      // 最直接的证据，也是 reports 视图设计最该消费的输入。
      if (!usedCliChain(t.events)) {
        t.diagnostic({
          code: "cli-chain-bypassed",
          level: "warning",
          message: `没走 niceeval show 钻取链就回答了（题型 ${q.kind}）`,
          data: { kind: q.kind, touched, readRawJson: readRawJson(t.events) },
        });
      }

      turn.succeeded();
    },
  });
}
