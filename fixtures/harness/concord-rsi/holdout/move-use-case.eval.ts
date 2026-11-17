import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, cleanup, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "把 docs/feature/library/use-case/upload.md 重命名为 add-book.md，文档标题与内容保持原意，现有使用入口继续可用。",
  async test(t) {
    const root = await project({
  "docs/feature/library/README.md": "# 书库\n\n[上传图书](use-case/upload.md)\n",
  "docs/feature/library/use-case/upload.md": "---\ntitle: 旧文档元数据\nstatus: draft\n---\n# 上传图书\n\n选择本地图书并上传。\n",
  "docs/feature/related-01/README.md": "# 入口 1\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 1 个场景。\n",
  "docs/feature/related-02/README.md": "# 入口 2\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 2 个场景。\n",
  "docs/feature/related-03/README.md": "# 入口 3\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 3 个场景。\n",
  "docs/feature/related-04/README.md": "# 入口 4\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 4 个场景。\n",
  "docs/feature/related-05/README.md": "# 入口 5\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 5 个场景。\n",
  "docs/feature/related-06/README.md": "# 入口 6\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 6 个场景。\n",
  "docs/feature/related-07/README.md": "# 入口 7\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 7 个场景。\n",
  "docs/feature/related-08/README.md": "# 入口 8\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 8 个场景。\n",
  "docs/feature/related-09/README.md": "# 入口 9\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 9 个场景。\n",
  "docs/feature/related-10/README.md": "# 入口 10\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 10 个场景。\n",
  "docs/feature/related-11/README.md": "# 入口 11\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 11 个场景。\n",
  "docs/feature/related-12/README.md": "# 入口 12\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 12 个场景。\n",
  "docs/feature/related-13/README.md": "# 入口 13\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 13 个场景。\n",
  "docs/feature/related-14/README.md": "# 入口 14\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 14 个场景。\n",
  "docs/feature/related-15/README.md": "# 入口 15\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 15 个场景。\n",
  "docs/feature/related-16/README.md": "# 入口 16\n\n使用[说明](../../feature/library/use-case/upload.md)完成第 16 个场景。\n"
});
    try {
      const turn = await t.send(JSON.stringify({ root, request: "把 docs/feature/library/use-case/upload.md 重命名为 add-book.md，文档标题与内容保持原意，现有使用入口继续可用。" }));
      turn.succeeded();
      t.check(await exists(root, "docs/feature/library/use-case/add-book.md") && !await exists(root, "docs/feature/library/use-case/upload.md") && (await text(root, "docs/feature/library/use-case/add-book.md"))?.includes("选择一本图书") === true, equals(true)).label("移动完成且保留正文");
      t.check(await linksTo(root, "docs/feature/library/README.md", "docs/feature/library/use-case/add-book.md"), equals(true)).label("入口引用已更新");
      t.check(await linksTo(root, "docs/feature/related-01/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-02/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-03/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-04/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-05/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-06/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-07/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-08/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-09/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-10/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-11/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-12/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-13/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-14/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-15/README.md", "docs/feature/library/use-case/add-book.md") && await linksTo(root, "docs/feature/related-16/README.md", "docs/feature/library/use-case/add-book.md"), equals(true)).label("全部跨页面入口同步更新");
      t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
    } finally { await cleanup(root); }
  },
});
