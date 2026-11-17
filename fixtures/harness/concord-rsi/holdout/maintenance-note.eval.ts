import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, cleanup, text, hasSupport, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "补充编辑器行距说明并维护项目文档的一致性",
  async test(t) {
    const root = await project({
  "docs/feature/editor/README.md": "---\ntitle: 编辑器\nstatus: draft\n---\n# 编辑器\n\n读者可以编辑正文。\n",
  "docs/feature/notification/architecture.md": "# 通知投递\n\n## 初始化 {#initialize}\n\n先建立投递队列再开始通知。\n",
  "memory/queue-layout.md": "---\nrelations:\n  - role: supports\n    target: docs/feature/notification/architecture.md#prepare\n---\n# 投递队列布局\n\n先建立投递队列再开始通知。\n",
  "docs/feature/notification/README.md": "# 通知\n\n[投递队列初始化](architecture.md#initialize)\n"
});
    try {
      const turn = await t.send(JSON.stringify({ root, request: "在 docs/feature/editor/README.md 写明编辑器现在可以调节行距，保留现有介绍。" }));
      turn.succeeded();
      t.check((await text(root, "docs/feature/editor/README.md"))?.includes("行距") === true && (await text(root, "docs/feature/editor/README.md"))?.includes("编辑正文") === true, equals(true)).label("补充行距并保留介绍");
      t.check(await hasSupport(root, "memory/queue-layout.md", "docs/feature/notification/architecture.md"), equals(true)).label("保留经验关系");
      t.check((await text(root, "docs/feature/notification/architecture.md"))?.includes("先建立投递队列再开始通知") === true, equals(true)).label("不删除相关架构来规避 finding");
      t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
    } finally { await cleanup(root); }
  },
});
