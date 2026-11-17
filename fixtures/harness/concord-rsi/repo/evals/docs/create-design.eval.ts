import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, cleanup, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "参考 drafts/example.md 的旧格式，新建 docs/design/search-index.md，标题“搜索索引”，比较内存索引与磁盘索引的启动速度、持久化与内存占用，不替用户采用方案。",
  async test(t) {
    const root = await project({
  "drafts/example.md": "---\ntitle: 方案名称\nstatus: draft\n---\n# 方案名称\n\n## 选择\n\n说明可选方案与取舍。\n"
});
    try {
      const turn = await t.send(JSON.stringify({ root, request: "参考 drafts/example.md 的旧格式，新建 docs/design/search-index.md，标题“搜索索引”，比较内存索引与磁盘索引的启动速度、持久化与内存占用，不替用户采用方案。" }));
      turn.succeeded();
      t.check((await text(root, "docs/design/search-index.md"))?.includes("内存") === true && (await text(root, "docs/design/search-index.md"))?.includes("磁盘") === true, equals(true)).label("设计保留两种选择");
      t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
    } finally { await cleanup(root); }
  },
});
