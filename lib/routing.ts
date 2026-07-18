/**
 * 路由层断言：agent 到底读了哪些文档页。
 *
 * agent-docs 机制的核心主张是「装完之后，agent 以随包 INDEX.md 为路由入口，
 * 按任务读到对的页面」。这条主张必须能被证伪，所以这里不看 agent 说了什么，
 * 只看它的事件流里实际碰过哪些文件路径。
 *
 * 为什么用「对整段事件流跑正则」而不是 t.calledTool("Read", ...)：
 * coding agent 读文件的方式不统一——codex 大量走 shell（cat / sed / rg），
 * claude-code 走原生 Read 工具。按工具名断言会把「换了种读法」误判成「没读文档」。
 * 把事件序列化后找路径，对读法不敏感，只对「有没有碰到这一页」敏感。
 */

import type { StreamEvent } from "niceeval";

/** 随包文档的单点路由入口。这个路径本身是 niceeval 的对外契约。 */
export const BUNDLED_INDEX = "node_modules/niceeval/INDEX.md";
/** 随包正文所在目录 */
export const BUNDLED_DOCS_DIR = "node_modules/niceeval/docs-site/zh";

/**
 * 把事件流里出现过的随包文档页抽出来。
 *
 * 返回的是相对包根的路径（如 `docs-site/zh/how-to/fixtures.mdx`），
 * 与 INDEX.md 里的树行一致，便于直接和「这道题应该读哪几页」比对。
 */
export function bundledPagesTouched(events: readonly StreamEvent[]): string[] {
  const haystack = events.map((e) => JSON.stringify(e)).join("\n");
  const pattern = /node_modules\/niceeval\/(INDEX\.md|docs-site\/zh\/[\w./-]+\.mdx)/g;
  return [...new Set([...haystack.matchAll(pattern)].map((m) => m[1]))].sort();
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
  const haystack = events.map((e) => JSON.stringify(e)).join("\n");
  return /niceeval\.com\/docs|github\.com\/CorrectRoadH\/niceeval\/(blob|tree|raw)\/main/.test(
    haystack,
  );
}

/**
 * 路由层的三个观测（入口、落点、有没有退回线上）全部用软分（.atLeast）挂断言，
 * 不用 gate：这一层回答的是「文档起作用了吗」，是归因用的计量，不是
 * 「这次接入算不算成功」的判据。让它拖垮 verdict 会把文档问题和机制问题
 * 混成一个分数，反而失去归因能力。具体挂法见 lib/install-eval.ts。
 */
