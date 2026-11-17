import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, cleanup, text, hasSupport, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "补充阅读器字号说明并维护项目文档的一致性",
  async test(t) {
    const root = await project({
  "docs/feature/reader/README.md": "---\ntitle: 阅读器\nstatus: draft\n---\n# 阅读器\n\n读者可以打开图书。\n",
  "docs/feature/search/architecture.md": "# 搜索索引\n\n## 初始化 {#initialize}\n\n先建立索引再开始搜索。\n",
  "memory/index-layout.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/search/architecture.md#prepare\n---\n# 索引布局\n\n先建立索引再开始搜索。\n",
  "docs/feature/search/README.md": "# 搜索\n\n[索引初始化](architecture.md#initialize)\n"
});
    try {
      const turn = await t.send(JSON.stringify({ root, request: "在 docs/feature/reader/README.md 写明阅读器现在可以调节字号，保留现有介绍。" }));
      turn.succeeded();
      t.check((await text(root, "docs/feature/reader/README.md"))?.includes("字号") === true && (await text(root, "docs/feature/reader/README.md"))?.includes("打开图书") === true, equals(true)).label("补充字号并保留介绍");
      t.check(await hasSupport(root, "memory/index-layout.md", "docs/feature/search/architecture.md"), equals(true)).label("保留经验关系");
      t.check((await text(root, "docs/feature/search/architecture.md"))?.includes("先建立索引再开始搜索") === true, equals(true)).label("不删除相关架构来规避 finding");
      t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
    } finally { await cleanup(root); }
  },
});
