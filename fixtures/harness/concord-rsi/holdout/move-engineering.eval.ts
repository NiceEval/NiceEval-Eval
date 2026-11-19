import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
import { loadText } from "niceeval/loaders";
import { project, text, exists, linksTo, cli } from "../../support/case.ts";

await loadText(new URL("../../assistant/SKILL.md", import.meta.url));

const from = "docs/engineering/cache-storage/README.md";
const to = "docs/engineering/cache-persistence/README.md";
const title = "# 缓存存储方案";
const body = "重启后先根据写入日志恢复索引，再接收访问请求。";
const references = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
  `docs/feature/cache-usage-${index + 1}/README.md`,
  `# 缓存使用场景 ${index + 1}\n\n参见[缓存存储方案](../../engineering/cache-storage/README.md)。\n`,
]));
const request = "把 docs/engineering/cache-storage/README.md 迁到 docs/engineering/cache-persistence/README.md。保留标题和正文，所有引用继续指向这篇文档。";

export default defineEval({
  description: request,
  async test(t) {
    const root = await project({
      [from]: `---\ntitle: 历史缓存条目\nstatus: draft\n---\n${title}\n\n${body}\n`,
      ...references,
    });
    const turn = await t.send(JSON.stringify({ root, request }));
    turn.succeeded();
    const moved = await text(root, to);
    t.check(
      !await exists(root, from) && moved?.includes(title) === true && moved.includes(body),
      equals(true),
    ).label("移动完成且保留标题与正文");
    const updateChecks = await Promise.all(Object.keys(references).map((path) => linksTo(root, path, to)));
    t.check(updateChecks.every(Boolean), equals(true)).label("全部跨页面入口同步更新");
    t.check((await cli(root, ["check", "--fresh", "--json"])).exitCode, equals(0)).label("真实 Concord check 通过");
  },
});
