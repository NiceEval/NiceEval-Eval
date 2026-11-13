import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "deploy-config: 把 config/staging.yaml 发布到 staging",
  async test(t) {
    const turn = await t.send("Deploy the staging config from config/staging.yaml.");
    turn.succeeded();
    t.check(turn.reply, includes("staging"));
  },
});
