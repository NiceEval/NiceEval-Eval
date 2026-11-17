import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, cleanup, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "把 docs/feature/search/architecture.md 移到 docs/feature/search/data-model.md，标题与正文不变，所有文档入口保持可用。",
  async test(t) {
    const root = await project({
  "docs/feature/search/architecture.md": "---\ntitle: 旧文档元数据\nstatus: draft\n---\n# 缓存选择\n\n比较进程内缓存与外部缓存。\n",
  "docs/feature/search/README.md": "# 搜索\n\n实现决策参考[缓存选择](architecture.md)。\n",
  "docs/feature/reference-01/README.md": "# 入口 1\n\n使用[说明](../../feature/search/architecture.md)完成第 1 个场景。\n",
  "docs/feature/reference-02/README.md": "# 入口 2\n\n使用[说明](../../feature/search/architecture.md)完成第 2 个场景。\n",
  "docs/feature/reference-03/README.md": "# 入口 3\n\n使用[说明](../../feature/search/architecture.md)完成第 3 个场景。\n",
  "docs/feature/reference-04/README.md": "# 入口 4\n\n使用[说明](../../feature/search/architecture.md)完成第 4 个场景。\n",
  "docs/feature/reference-05/README.md": "# 入口 5\n\n使用[说明](../../feature/search/architecture.md)完成第 5 个场景。\n",
  "docs/feature/reference-06/README.md": "# 入口 6\n\n使用[说明](../../feature/search/architecture.md)完成第 6 个场景。\n",
  "docs/feature/reference-07/README.md": "# 入口 7\n\n使用[说明](../../feature/search/architecture.md)完成第 7 个场景。\n",
  "docs/feature/reference-08/README.md": "# 入口 8\n\n使用[说明](../../feature/search/architecture.md)完成第 8 个场景。\n",
  "docs/feature/reference-09/README.md": "# 入口 9\n\n使用[说明](../../feature/search/architecture.md)完成第 9 个场景。\n",
  "docs/feature/reference-10/README.md": "# 入口 10\n\n使用[说明](../../feature/search/architecture.md)完成第 10 个场景。\n",
  "docs/feature/reference-11/README.md": "# 入口 11\n\n使用[说明](../../feature/search/architecture.md)完成第 11 个场景。\n",
  "docs/feature/reference-12/README.md": "# 入口 12\n\n使用[说明](../../feature/search/architecture.md)完成第 12 个场景。\n",
  "docs/feature/reference-13/README.md": "# 入口 13\n\n使用[说明](../../feature/search/architecture.md)完成第 13 个场景。\n",
  "docs/feature/reference-14/README.md": "# 入口 14\n\n使用[说明](../../feature/search/architecture.md)完成第 14 个场景。\n",
  "docs/feature/reference-15/README.md": "# 入口 15\n\n使用[说明](../../feature/search/architecture.md)完成第 15 个场景。\n",
  "docs/feature/reference-16/README.md": "# 入口 16\n\n使用[说明](../../feature/search/architecture.md)完成第 16 个场景。\n"
});
    try {
      const turn = await t.send(JSON.stringify({ root, request: "把 docs/feature/search/architecture.md 移到 docs/feature/search/data-model.md，标题与正文不变，所有文档入口保持可用。" }));
      turn.succeeded();
      t.check(await exists(root, "docs/feature/search/data-model.md") && !await exists(root, "docs/feature/search/architecture.md") && (await text(root, "docs/feature/search/data-model.md"))?.includes("外部缓存") === true, equals(true)).label("移动完成且保留正文");
      t.check(await linksTo(root, "docs/feature/search/README.md", "docs/feature/search/data-model.md"), equals(true)).label("现有引用已更新");
      t.check(await linksTo(root, "docs/feature/reference-01/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-02/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-03/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-04/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-05/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-06/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-07/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-08/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-09/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-10/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-11/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-12/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-13/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-14/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-15/README.md", "docs/feature/search/data-model.md") && await linksTo(root, "docs/feature/reference-16/README.md", "docs/feature/search/data-model.md"), equals(true)).label("全部跨页面入口同步更新");
      t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
    } finally { await cleanup(root); }
  },
});
