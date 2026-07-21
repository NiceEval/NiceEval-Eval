/**
 * 路由层断言：agent 到底读了哪些文档页。
 *
 * agent-docs 机制的核心主张是「装完之后，agent 以随包 INDEX.md 为路由入口，
 * 按任务读到对的页面」。这条主张必须能被证伪，所以这里不看 agent 说了什么，
 * 只看它的事件流里实际碰过哪些文件路径。
 *
 * 为什么用「对工具调用输入跑正则」而不是 t.calledTool("Read", ...)：
 * coding agent 读文件的方式不统一——codex 大量走 shell（cat / sed / rg），
 * claude-code 走原生 Read 工具。按工具名断言会把「换了种读法」误判成「没读文档」。
 * 对调用输入找路径，对读法不敏感，只对「有没有主动碰这一页」敏感；
 * 为什么只看输入侧不看输出侧，见 calledInputs 的注释。
 */

import type { StreamEvent } from "niceeval";

/** 随包文档的单点路由入口。这个路径本身是 niceeval 的对外契约。 */
export const BUNDLED_INDEX = "node_modules/niceeval/INDEX.md";
/** 随包正文所在目录 */
export const BUNDLED_DOCS_DIR = "node_modules/niceeval/docs-site/zh";

/**
 * 只取工具调用的**输入**侧做匹配材料（action.called 的 input），不看输出。
 *
 * 之前对整段事件流（含 action.result 与消息文本）跑正则，会把「字符串路过」误判成
 * 「读了 / 抓了」：`ls`/`find` 的输出里列出的文件路径会把没读过的页面全记成 touched；
 * 包内 README 正文里的 niceeval.com/docs 链接被 cat 出来，会把「读了随包 README」
 * 误判成「退回线上文档」（v0.9.1 两次运行的 fellBack 误报都来自这里）。
 * 输入侧才对应「agent 主动指名要这个路径 / 这个 URL」；代价是经由脚本 glob 间接读到的
 * 页面会漏计——路由层是软分计量，宁可少计不误计。
 */
function calledInputs(events: readonly StreamEvent[]): string {
  return events
    .filter((e) => e.type === "action.called")
    .map((e) => JSON.stringify(e.input))
    .join("\n");
}

/**
 * 把事件流里 agent 主动读过的随包文档页抽出来。
 *
 * 返回的是相对包根的路径（如 `docs-site/zh/how-to/fixtures.mdx`），
 * 与 INDEX.md 里的树行一致，便于直接和「这道题应该读哪几页」比对。
 */
export function bundledPagesTouched(events: readonly StreamEvent[]): string[] {
  const pattern = /node_modules\/niceeval\/(INDEX\.md|docs-site\/zh\/[\w./-]+\.mdx)/g;
  return [...new Set([...calledInputs(events).matchAll(pattern)].map((m) => m[1]))].sort();
}

/** agent 是否读过随包索引入口 */
export function touchedIndex(events: readonly StreamEvent[]): boolean {
  return bundledPagesTouched(events).includes("INDEX.md");
}

/**
 * 是否读到了这道题「应该读」的页面。
 *
 * expected 里任意一页命中即算路由正确——出题时给的是一组等价的合格落点，
 * 不是唯一解。要求全部命中会把「读了两页里更对的那一页」判成失败。
 */
export function routedTo(events: readonly StreamEvent[], expected: string[]): boolean {
  const touched = bundledPagesTouched(events);
  return expected.some((page) => touched.includes(page));
}

/**
 * 有没有退回「训练记忆 / 线上文档」。
 *
 * 安装后仍去抓官网或 GitHub main 分支，说明随包文档没接住这个 agent——
 * 读到的可能是另一个版本的 API。这是路由层最值得单独计量的失败形态。
 */
export function fellBackToOnlineDocs(events: readonly StreamEvent[]): boolean {
  return /niceeval\.com\/docs|github\.com\/CorrectRoadH\/niceeval\/(blob|tree|raw)\/main/.test(
    calledInputs(events),
  );
}

/**
 * 路由层的三个观测（入口、落点、有没有退回线上）全部用软分（.atLeast）挂断言，
 * 不用 gate：这一层回答的是「文档起作用了吗」，是归因用的计量，不是
 * 「这次接入算不算成功」的判据。让它拖垮 verdict 会把文档问题和机制问题
 * 混成一个分数，反而失去归因能力。具体挂法见各 evals/install/*.eval.ts。
 */
