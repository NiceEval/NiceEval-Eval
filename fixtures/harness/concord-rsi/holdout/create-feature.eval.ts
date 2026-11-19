import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
import { equals } from "niceeval/expect";
import { project, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

export default defineEval({
  description: "参考 drafts/example.md 的旧文档格式，新建 docs/feature/annotation-sync/README.md，标题“同步批注”，说明用户可同步批注为 JSON，并写明验收：同步结果包含全部批注位置与正文。不要改 drafts/example.md。",
  async test(t) {
    const root = await project({
  "drafts/example.md": "---\ntitle: 功能名称\nstatus: draft\n---\n# 功能名称\n\n## 用户目标\n\n填写目标。\n\n## 验收\n\n填写完成条件。\n"
});
    const turn = await t.send(JSON.stringify({ root, request: "参考 drafts/example.md 的旧文档格式，新建 docs/feature/annotation-sync/README.md，标题“同步批注”，说明用户可同步批注为 JSON，并写明验收：同步结果包含全部批注位置与正文。不要改 drafts/example.md。" }));
    turn.succeeded();
    t.check((await text(root, "docs/feature/annotation-sync/README.md"))?.includes("JSON") === true && (await text(root, "docs/feature/annotation-sync/README.md"))?.includes("正文") === true && (await text(root, "docs/feature/annotation-sync/README.md"))?.includes("位置") === true, equals(true)).label("新功能具有目标与验收");
    t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
  },
});
