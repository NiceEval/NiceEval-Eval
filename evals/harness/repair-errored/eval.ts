import { defineScoreEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

const EXPECTED_CONFIG = {
  endpoint: "memory://policy",
  complianceEndpoint: "memory://compliance",
} as const;

export default defineScoreEval({
  description: "诊断只影响部分 case 的执行错误，只修共享运行时配置并全量复验",
  tags: ["harness", "repair", "errored", "runtime", "multi-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  async test(t) {
    // 候选镜像只带共享依赖；把本题自己的起始 repo 铺进当前 attempt 的 workspace 根目录。
    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/repair-errored/repo/", import.meta.url),
      ".",
    );

    const turn1 = await t.send("先调查 local experiment 里为什么只有一部分 case 跑不起来，暂时别改。");

    turn1.calledTool("shell", { status: "completed" }).points(1).gate();
    turn1.judge.autoevals
      .closedQA(
        "输入是本轮标准工具调用 JSON。必须能从真实调用的入参、输出和状态确认：助手运行了非 dry-run 的 local experiment；实际结果为 5 个 eval、3 passed、0 failed、2 errored，执行错误是 policy/refund 与 policy/warranty；随后使用 NiceEval 的结果查看能力下钻了 errored attempt。local 因 errored 返回失败状态不应判 N。缺任一项判 N。",
        { on: JSON.stringify(turn1.toolCalls) },
      )
      .points(3)
      .gate();
    turn1.judge.autoevals
      .closedQA(
        "只判断助手回复。诊断必须准确报告 3 passed、0 failed、2 errored，并指出 refund 与 warranty 共享的 compliance 检查连接 http://compliance.invalid:8787 时 ECONNREFUSED；普通 policy endpoint 已经可用，所以另外三项仍通过；根因是 config/policy.json 的 complianceEndpoint，而不是业务答案、eval 或断言。还应明确本轮没有修改文件。全部满足才判 Y。",
        { on: turn1.message },
      )
      .points(4)
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("诊断轮没有提前修改项目"))
      .points(1)
      .gate();
    turn1.succeeded().points(1).gate();

    const candidateVersion = String(t.flags.candidateVersion);
    const fullRerunRule = candidateVersion.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：默认会自动重试两个 errored case、携入三个 passed case；工具调用证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行），否则不算全量复验。";
    const turn2 = await t.send("只修这个运行时配置问题，再全量确认。");

    turn2.calledTool("shell", { status: "completed" }).points(1).gate();
    turn2.judge.autoevals
      .closedQA(
        `输入是本轮标准工具调用 JSON。必须能从真实调用的入参、输出和状态确认：修改后执行了完整 local experiment，并实际得到 5 passed、0 failed、0 errored。${fullRerunRule} 缺任一项判 N。`,
        { on: JSON.stringify(turn2.toolCalls) },
      )
      .points(3)
      .gate();
    turn2.judge.autoevals
      .closedQA(
        "只判断助手回复。必须明确说明只把 config/policy.json 的 complianceEndpoint 恢复为 memory://compliance，没有修改业务实现、eval、断言或 experiment；准确汇报最终 5 passed、0 failed、0 errored。缺任一项判 N。",
        { on: turn2.message },
      )
      .points(3)
      .gate();

    const actualConfig = JSON.parse(await t.sandbox.readText("config/policy.json"));
    t.sandbox.fileChanged("config/policy.json").points(1);
    t.check(actualConfig, equals(EXPECTED_CONFIG)).points(3).gate();

    turn2.succeeded().points(1).gate();
  },
});
