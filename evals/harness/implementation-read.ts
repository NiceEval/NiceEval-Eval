import type { JsonValue } from "niceeval";
import { satisfies, toolMatch } from "niceeval/expect";

// 类型声明是产品给作者看的一部分；`src/` 与 `dist/` 里的可执行代码不是。
// 整个 `dist` 目录的搜索算读实现：它扫到的主要是 .js。
const PACKAGE_PATH = /node_modules\/niceeval\/(?:src|dist)(?:\/[\w@.\/-]*)?/g;
const DECLARATION = /\.d\.[cm]?ts$/;

export function referencesImplementation(input: unknown): boolean {
  return (JSON.stringify(input) ?? "").match(PACKAGE_PATH)?.some((path) => !DECLARATION.test(path)) ?? false;
}

/** 一次工具调用的输入指向 NiceEval 的实现代码（不含 `.d.ts` 类型声明）。只看输入文本。 */
export const readsImplementation = toolMatch({
  input: satisfies<JsonValue>("references NiceEval implementation code", referencesImplementation),
});
