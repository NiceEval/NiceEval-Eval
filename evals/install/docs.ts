/**
 * 两道安装题共用的文档地址事实。只列地址，是否计分由各题 eval.ts 决定。
 */

/** 候选版本发布时的 INIT.md（按 tag 存档），题面让 agent 读这一份。 */
export function candidateInitDocUrl(version: string): string {
  return `https://raw.githubusercontent.com/NiceEval/NiceEval/v${version}/INIT.md`;
}

/**
 * NiceEval 的线上文档落点：文档站，以及仓库 `main` 分支上的任何文件。安装之后 agent 该读随包文档，
 * 读这些地址就是读到了另一个版本。把题面给的 tag 换成 main 是最顺手的回退，所以 raw 地址与仓库的新旧名字都要列；
 * 主机名和 owner/repo 不分大小写，匹配时配 `referencesAnyPath(..., { ignoreCase: true })`。带版本 tag 的地址不在其中。
 */
export const ONLINE_MAIN_DOC_REFERENCES = [
  "niceeval.com/docs",
  ...["NiceEval/NiceEval", "CorrectRoadH/niceeval"].flatMap((repo) => [
    `github.com/${repo}/blob/main`,
    `github.com/${repo}/tree/main`,
    `github.com/${repo}/raw/main`,
    `github.com/${repo}/raw/refs/heads/main`,
    `raw.githubusercontent.com/${repo}/main`,
    `raw.githubusercontent.com/${repo}/refs/heads/main`,
  ]),
] as const satisfies readonly [string, ...string[]];
