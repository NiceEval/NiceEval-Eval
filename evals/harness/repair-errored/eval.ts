import { defineScoreEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";
import { turnEvidence } from "../support.ts";

const WORKING_CONFIG = {
  endpoint: "memory://policy",
  complianceEndpoint: "memory://compliance",
} as const;
const BROKEN_COMPLIANCE_ENDPOINT = "http://compliance.invalid:8787";

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

    const version = String(t.flags.candidateVersion);
    const startingConfig = JSON.parse(await t.sandbox.readText("config/policy.json")) as {
      endpoint?: string;
      complianceEndpoint?: string;
    };
    if (
      startingConfig.endpoint !== WORKING_CONFIG.endpoint ||
      startingConfig.complianceEndpoint !== BROKEN_COMPLIANCE_ENDPOINT
    ) {
      throw new Error("repair-errored repo 缺少预期的局部 compliance endpoint 故障");
    }
    const diagnosisCommandStart = t.o11y.shellCommands.length;
    const diagnosis = await t.send("先调查 local experiment 里为什么只有一部分 case 跑不起来，暂时别改。");
    const diagnosisEvidence = turnEvidence(
      version,
      diagnosis.message,
      t.o11y.shellCommands.slice(diagnosisCommandStart),
    );

    diagnosis.judge.autoevals
      .closedQA(
        "输入是一份宿主侧证据 JSON，包含本轮助手原始回复和本轮真实 shell 命令。命令证据必须显示助手确实运行了非 dry-run 的 local experiment，并使用 NiceEval 的结果查看能力下钻 errored attempt；回复必须准确报告共 5 个 eval、3 passed、0 failed、2 errored，并点名 policy/refund 与 policy/warranty 是执行错误。exp 因 errored 返回退出码 1 是预期现象。只读源码后猜测、没有实际运行或混淆 failed/errored 都判 N。",
        { on: diagnosisEvidence },
      )
      .points(3)
      .gate();
    diagnosis.judge.autoevals
      .closedQA(
        "输入是一份宿主侧证据 JSON。诊断必须根据实际错误证据指出：refund 与 warranty 共享的 compliance 检查连接 http://compliance.invalid:8787 时 ECONNREFUSED；普通 policy endpoint 已经是可用的 memory://policy，所以 exchange、shipping、privacy 仍通过；根因是 config/policy.json 的 complianceEndpoint，而不是业务答案、eval 或断言。还应明确本轮没有修改文件。全部满足才判 Y。",
        { on: diagnosisEvidence },
      )
      .points(4)
      .gate();
    t.check(t.sandbox.diff.isEmpty(), isTrue("诊断轮没有提前修改项目"))
      .points(1)
      .gate();
    diagnosis.succeeded().points(1).gate();

    const fullRerunRule = version.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：默认会自动重试两个 errored case、携入三个 passed case；命令证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行），否则不算全量复验。";
    const repairCommandStart = t.o11y.shellCommands.length;
    const repair = await t.send("只修这个运行时配置问题，再全量确认。");
    const repairEvidence = turnEvidence(
      version,
      repair.message,
      t.o11y.shellCommands.slice(repairCommandStart),
    );

    repair.judge.autoevals
      .closedQA(
        `输入是一份宿主侧证据 JSON。必须同时满足：回复明确说明只把 config/policy.json 的 complianceEndpoint 恢复为 memory://compliance，没有修改业务实现、eval、断言或 experiment；命令证据显示修改后真实执行了完整 local experiment 且最终命令成功；准确汇报最终 5 passed、0 failed、0 errored。${fullRerunRule} 缺任一项判 N。`,
        { on: repairEvidence },
      )
      .points(4)
      .gate();

    const repairedConfig = JSON.parse(await t.sandbox.readText("config/policy.json"));
    t.sandbox.fileChanged("config/policy.json").points(1);
    t.check(repairedConfig, equals(WORKING_CONFIG)).points(3).gate();

    repair.succeeded().points(1).gate();
  },
});
