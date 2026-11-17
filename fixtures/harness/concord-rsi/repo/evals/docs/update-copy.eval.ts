import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, cleanup, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "请在 docs/feature/reader/README.md 补充一句：支持夜间模式。保留原有内容。",
  async test(t) {
    const root = await project({
  "docs/feature/reader/README.md": "# 阅读器\n\n读者可以打开图书。\n"
});
    try {
      const turn = await t.send(JSON.stringify({ root, request: "请在 docs/feature/reader/README.md 补充一句：支持夜间模式。保留原有内容。" }));
      turn.succeeded();
      t.check((await text(root, "docs/feature/reader/README.md"))?.includes("夜间模式") === true && (await text(root, "docs/feature/reader/README.md"))?.includes("打开图书") === true, equals(true)).label("保留原意并补充夜间模式");
      t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
    } finally { await cleanup(root); }
  },
});
