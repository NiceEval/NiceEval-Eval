import type { JsonValue } from "niceeval";
import { satisfies, toolMatch } from "niceeval/expect";

// 类型声明是产品给作者看的一部分；`src/` 下的源码和 `dist/` 下的 .js 不是。
// 只认明确的实现文件路径，不猜目录搜索的语义：`rg x dist -g '*.d.ts'` 只扫声明，不能算读实现。
const IMPLEMENTATION = /node_modules\/niceeval\/(?:src\/[\w@.\/-]+|dist\/[\w@.\/-]*\.[cm]?js)\b/;

export function referencesImplementation(input: unknown): boolean {
  return IMPLEMENTATION.test(JSON.stringify(input) ?? "");
}

/** 一次工具调用的输入指向 NiceEval 的实现文件（不含 `.d.ts` 类型声明）。只看输入文本。 */
export const readsImplementation = toolMatch({
  input: satisfies<JsonValue>("references NiceEval implementation code", referencesImplementation),
});
