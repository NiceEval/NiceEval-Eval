import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "在 docs/feature/reader/README.md 增加指向 use-case/open.md 的 Markdown 相对链接，链接名为“打开图书”。",
  async test(t) {
    const root = await project({
  "docs/feature/reader/README.md": "# 阅读器\n\n读者可以打开图书。\n",
  "docs/feature/reader/use-case/open.md": "# 打开图书\n\n打开一本已有的图书。\n"
});
    const turn = await t.send(JSON.stringify({ root, request: "在 docs/feature/reader/README.md 增加指向 use-case/open.md 的 Markdown 相对链接，链接名为“打开图书”。" }));
    turn.succeeded();
    t.check((await text(root, "docs/feature/reader/README.md"))?.includes("[打开图书](use-case/open.md)") === true, equals(true)).label("真实相对链接");
    t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
  },
});
