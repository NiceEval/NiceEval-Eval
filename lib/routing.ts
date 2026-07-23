/**
 * 路由层的匹配料：判定「agent 读了哪些文档页」用的正则常量。
 *
 * agent-docs 机制的核心主张是「装完之后，agent 以随包 INDEX.md 为路由入口，
 * 按任务读到对的页面」。这条主张要能被证伪——判据是**碰过哪个路径**，不是**用了哪个工具**：
 * codex 读文件走 shell（cat / sed / rg），路径落在 input.command 里。所以各 eval 直接
 * `t.calledTool("shell", { input: { command: 某条正则 } })`，不再自己 map 事件流 /
 * JSON.stringify / matchAll。ToolMatch 的 RegExp 只测 input 侧、命中不了字段还会对整个
 * input 序列化串兜底测一次——既覆盖各种读法，又结构上看不到工具输出（早期对 action.result
 * 跑正则把 ls 输出、README 正文误记成 touched 的坑，官方匹配天然不会踩）。
 *
 * 各 eval 自己的 EXPECTED_PAGES 也直接写成一条 RegExp（用 `(how-to|tutorials)` 这种交替把
 * 新旧两代路径编进去，命中其一即算路由对），既喂给 calledTool 也喂给 assertPagesInCandidate
 * ——全程是数据，没有把数组转正则的中间函数。
 *
 * miss 时的归因不用手搓解析：calledTool 失败时会把同名 shell 调用的出入参作为近失
 * 证据带进断言的 received，「agent 实际读了哪几页」直接在报告里看。
 */

/** 随包索引入口，读到它算走对了路由起点 */
export const INDEX_RE = /node_modules\/niceeval\/INDEX\.md/;

/**
 * 接入等级页。单独一条、不并进各 eval 的 EXPECTED_PAGES：那条正则是「一组等价落点，命中
 * 其一即算路由对」，把 tier 掺进去只会让它更容易蒙中，冲淡「读到与宿主形态匹配的传输页」
 * 这个判定。而澄清判据里「摆出 Tier 三档」要的知识只有这一页讲，读没读到是可独立证伪的
 * 一分，所以在路由层单列一个计量点。
 */
export const TIER_PAGE_RE = /docs-site\/zh\/explanation\/tier\.mdx/;

/** 退回训练记忆 / 线上文档：装完还去抓官网或 GitHub main，说明随包文档没接住这个 agent */
export const ONLINE_DOCS_RE =
  /niceeval\.com\/docs|github\.com\/CorrectRoadH\/niceeval\/(blob|tree|raw)\/main/;
