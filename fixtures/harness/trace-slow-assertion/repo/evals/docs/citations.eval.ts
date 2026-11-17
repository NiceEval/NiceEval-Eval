import { setTimeout as sleep } from "node:timers/promises";
import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";

export default defineEval({
  description: "文档引用及链接可访问性",
  async test(t) {
    const turn = await t.send("Citations for deployment.");
    turn.succeeded();
    t.check(turn.reply, includes("部署文档"));
    const links: string[] = turn.reply.match(/https:\/\/docs\.example\.com\/deployment\/\d+/g) ?? [];
    // 确定性模拟链接检查延迟，不访问外部服务。
    await t.check(links, satisfies("链接可访问性", async (urls: string[]) => {
      for (const url of urls) {
        await sleep(5_000, undefined, { signal: t.signal });
        if (!/^https:\/\/docs\.example\.com\/deployment\/\d+$/.test(url)) return false;
      }
      return urls.length === 20;
    })).label("引用链接都可访问");
  },
});
