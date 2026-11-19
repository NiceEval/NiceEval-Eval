import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, text, exists, linksTo, hasSupport, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "这个项目的 concord check 没过。请运行检查，按 finding 修复文档，保留功能、页面和文字含义；不要删文档或删除链接来消除 finding。",
  async test(t) {
    const root = await project({
  "docs/feature/billing/README.md": "# 计费\n\n账单在[初始化入口](architecture.md#initialize)准备。\n",
  "docs/feature/billing/architecture.md": "---\ntitle: 旧文档元数据\nstatus: draft\n---\n# 计费账单\n\n## 初始化 {#initialize}\n\n生成账单后可计费。\n\n## 阶段 01 {#stage-01}\n\n生成账单时完成第 1 阶段。\n\n## 阶段 02 {#stage-02}\n\n生成账单时完成第 2 阶段。\n\n## 阶段 03 {#stage-03}\n\n生成账单时完成第 3 阶段。\n\n## 阶段 04 {#stage-04}\n\n生成账单时完成第 4 阶段。\n\n## 阶段 05 {#stage-05}\n\n生成账单时完成第 5 阶段。\n\n## 阶段 06 {#stage-06}\n\n生成账单时完成第 6 阶段。\n\n## 阶段 07 {#stage-07}\n\n生成账单时完成第 7 阶段。\n\n## 阶段 08 {#stage-08}\n\n生成账单时完成第 8 阶段。\n\n## 阶段 09 {#stage-09}\n\n生成账单时完成第 9 阶段。\n\n## 阶段 10 {#stage-10}\n\n生成账单时完成第 10 阶段。\n\n## 阶段 11 {#stage-11}\n\n生成账单时完成第 11 阶段。\n\n## 阶段 12 {#stage-12}\n\n生成账单时完成第 12 阶段。\n\n## 阶段 13 {#stage-13}\n\n生成账单时完成第 13 阶段。\n\n## 阶段 14 {#stage-14}\n\n生成账单时完成第 14 阶段。\n\n## 阶段 15 {#stage-15}\n\n生成账单时完成第 15 阶段。\n\n## 阶段 16 {#stage-16}\n\n生成账单时完成第 16 阶段。\n\n## 阶段 17 {#stage-17}\n\n生成账单时完成第 17 阶段。\n\n## 阶段 18 {#stage-18}\n\n生成账单时完成第 18 阶段。\n\n## 阶段 19 {#stage-19}\n\n生成账单时完成第 19 阶段。\n\n## 阶段 20 {#stage-20}\n\n生成账单时完成第 20 阶段。\n\n## 阶段 21 {#stage-21}\n\n生成账单时完成第 21 阶段。\n\n## 阶段 22 {#stage-22}\n\n生成账单时完成第 22 阶段。\n\n## 阶段 23 {#stage-23}\n\n生成账单时完成第 23 阶段。\n\n## 阶段 24 {#stage-24}\n\n生成账单时完成第 24 阶段。\n\n## 阶段 25 {#stage-25}\n\n生成账单时完成第 25 阶段。\n\n## 阶段 26 {#stage-26}\n\n生成账单时完成第 26 阶段。\n\n## 阶段 27 {#stage-27}\n\n生成账单时完成第 27 阶段。\n\n## 阶段 28 {#stage-28}\n\n生成账单时完成第 28 阶段。\n\n## 阶段 29 {#stage-29}\n\n生成账单时完成第 29 阶段。\n\n## 阶段 30 {#stage-30}\n\n生成账单时完成第 30 阶段。\n\n## 阶段 31 {#stage-31}\n\n生成账单时完成第 31 阶段。\n\n## 阶段 32 {#stage-32}\n\n生成账单时完成第 32 阶段。\n\n## 阶段 33 {#stage-33}\n\n生成账单时完成第 33 阶段。\n\n## 阶段 34 {#stage-34}\n\n生成账单时完成第 34 阶段。\n\n## 阶段 35 {#stage-35}\n\n生成账单时完成第 35 阶段。\n\n## 阶段 36 {#stage-36}\n\n生成账单时完成第 36 阶段。\n\n## 阶段 37 {#stage-37}\n\n生成账单时完成第 37 阶段。\n\n## 阶段 38 {#stage-38}\n\n生成账单时完成第 38 阶段。\n\n## 阶段 39 {#stage-39}\n\n生成账单时完成第 39 阶段。\n\n## 阶段 40 {#stage-40}\n\n生成账单时完成第 40 阶段。\n\n",
  "memory/lesson-01.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-01\n---\n# 账单阶段 1 的经验\n\n第 1 阶段完成后再继续后续阶段。\n",
  "memory/lesson-02.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-02\n---\n# 账单阶段 2 的经验\n\n第 2 阶段完成后再继续后续阶段。\n",
  "memory/lesson-03.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-03\n---\n# 账单阶段 3 的经验\n\n第 3 阶段完成后再继续后续阶段。\n",
  "memory/lesson-04.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-04\n---\n# 账单阶段 4 的经验\n\n第 4 阶段完成后再继续后续阶段。\n",
  "memory/lesson-05.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-05\n---\n# 账单阶段 5 的经验\n\n第 5 阶段完成后再继续后续阶段。\n",
  "memory/lesson-06.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-06\n---\n# 账单阶段 6 的经验\n\n第 6 阶段完成后再继续后续阶段。\n",
  "memory/lesson-07.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-07\n---\n# 账单阶段 7 的经验\n\n第 7 阶段完成后再继续后续阶段。\n",
  "memory/lesson-08.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-08\n---\n# 账单阶段 8 的经验\n\n第 8 阶段完成后再继续后续阶段。\n",
  "memory/lesson-09.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-09\n---\n# 账单阶段 9 的经验\n\n第 9 阶段完成后再继续后续阶段。\n",
  "memory/lesson-10.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-10\n---\n# 账单阶段 10 的经验\n\n第 10 阶段完成后再继续后续阶段。\n",
  "memory/lesson-11.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-11-legacy\n---\n# 账单阶段 11 的经验\n\n第 11 阶段完成后再继续后续阶段。\n",
  "memory/lesson-12.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-12\n---\n# 账单阶段 12 的经验\n\n第 12 阶段完成后再继续后续阶段。\n",
  "memory/lesson-13.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-13\n---\n# 账单阶段 13 的经验\n\n第 13 阶段完成后再继续后续阶段。\n",
  "memory/lesson-14.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-14\n---\n# 账单阶段 14 的经验\n\n第 14 阶段完成后再继续后续阶段。\n",
  "memory/lesson-15.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-15\n---\n# 账单阶段 15 的经验\n\n第 15 阶段完成后再继续后续阶段。\n",
  "memory/lesson-16.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-16\n---\n# 账单阶段 16 的经验\n\n第 16 阶段完成后再继续后续阶段。\n",
  "memory/lesson-17.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-17\n---\n# 账单阶段 17 的经验\n\n第 17 阶段完成后再继续后续阶段。\n",
  "memory/lesson-18.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-18\n---\n# 账单阶段 18 的经验\n\n第 18 阶段完成后再继续后续阶段。\n",
  "memory/lesson-19.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-19\n---\n# 账单阶段 19 的经验\n\n第 19 阶段完成后再继续后续阶段。\n",
  "memory/lesson-20.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-20\n---\n# 账单阶段 20 的经验\n\n第 20 阶段完成后再继续后续阶段。\n",
  "memory/lesson-21.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-21\n---\n# 账单阶段 21 的经验\n\n第 21 阶段完成后再继续后续阶段。\n",
  "memory/lesson-22.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-22\n---\n# 账单阶段 22 的经验\n\n第 22 阶段完成后再继续后续阶段。\n",
  "memory/lesson-23.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-23\n---\n# 账单阶段 23 的经验\n\n第 23 阶段完成后再继续后续阶段。\n",
  "memory/lesson-24.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-24\n---\n# 账单阶段 24 的经验\n\n第 24 阶段完成后再继续后续阶段。\n",
  "memory/lesson-25.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-25\n---\n# 账单阶段 25 的经验\n\n第 25 阶段完成后再继续后续阶段。\n",
  "memory/lesson-26.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-26\n---\n# 账单阶段 26 的经验\n\n第 26 阶段完成后再继续后续阶段。\n",
  "memory/lesson-27.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-27\n---\n# 账单阶段 27 的经验\n\n第 27 阶段完成后再继续后续阶段。\n",
  "memory/lesson-28.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-28\n---\n# 账单阶段 28 的经验\n\n第 28 阶段完成后再继续后续阶段。\n",
  "memory/lesson-29.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-29\n---\n# 账单阶段 29 的经验\n\n第 29 阶段完成后再继续后续阶段。\n",
  "memory/lesson-30.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-30\n---\n# 账单阶段 30 的经验\n\n第 30 阶段完成后再继续后续阶段。\n",
  "memory/lesson-31.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-31\n---\n# 账单阶段 31 的经验\n\n第 31 阶段完成后再继续后续阶段。\n",
  "memory/lesson-32.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-32\n---\n# 账单阶段 32 的经验\n\n第 32 阶段完成后再继续后续阶段。\n",
  "memory/lesson-33.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-33\n---\n# 账单阶段 33 的经验\n\n第 33 阶段完成后再继续后续阶段。\n",
  "memory/lesson-34.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-34\n---\n# 账单阶段 34 的经验\n\n第 34 阶段完成后再继续后续阶段。\n",
  "memory/lesson-35.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-35\n---\n# 账单阶段 35 的经验\n\n第 35 阶段完成后再继续后续阶段。\n",
  "memory/lesson-36.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-36\n---\n# 账单阶段 36 的经验\n\n第 36 阶段完成后再继续后续阶段。\n",
  "memory/lesson-37.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-37\n---\n# 账单阶段 37 的经验\n\n第 37 阶段完成后再继续后续阶段。\n",
  "memory/lesson-38.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-38\n---\n# 账单阶段 38 的经验\n\n第 38 阶段完成后再继续后续阶段。\n",
  "memory/lesson-39.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-39\n---\n# 账单阶段 39 的经验\n\n第 39 阶段完成后再继续后续阶段。\n",
  "memory/lesson-40.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/billing/architecture.md#stage-40\n---\n# 账单阶段 40 的经验\n\n第 40 阶段完成后再继续后续阶段。\n"
});
    const turn = await t.send(JSON.stringify({ root, request: "这个项目的 concord check 没过。请运行检查，按 finding 修复文档，保留功能、页面和文字含义；不要删文档或删除链接来消除 finding。" }));
    turn.succeeded();
    t.check((await text(root, "docs/feature/billing/README.md"))?.includes("architecture.md#") === true && (await text(root, "docs/feature/billing/architecture.md"))?.includes("生成账单") === true, equals(true)).label("保留链接并修复锚点");
    t.check(await hasSupport(root, "memory/lesson-11.md", "docs/feature/billing/architecture.md"), equals(true)).label("保留真实经验关系");
    t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
  },
});
