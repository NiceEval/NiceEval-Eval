import { defineScoreEval } from "niceeval";
import { commandSucceeded, isTrue } from "niceeval/expect";

const EXISTING_EVALS = [
  "evals/policy/exchange.eval.ts",
  "evals/policy/privacy.eval.ts",
  "evals/policy/refund.eval.ts",
  "evals/policy/shipping.eval.ts",
  "evals/policy/warranty.eval.ts",
] as const;

export default defineScoreEval({
  description: "给绿色 experiment 补一条真实回归，先复现再修实现并全量复验",
  tags: ["harness", "author", "regression", "multi-turn"],
  timeoutMs: 25 * 60 * 1000,
  diff: { ignore: [".niceeval/**"] },
  async test(t) {
    // 候选镜像只带共享依赖；把本题自己的起始 repo 铺进当前 attempt 的 workspace 根目录。
    await t.sandbox.uploadDirectory(
      new URL("../../../fixtures/harness/add-regression/repo/", import.meta.url),
      ".",
    );

    const turn1 = await t.send(
      "客户报告：订单已经进入履约或出库后，policy agent 仍说可以取消。先把这个问题补成一条新的回归 eval，并在完整 local experiment 里实际跑出失败；暂时不要修业务实现。",
    );

    turn1.calledTool("shell", { status: "completed" }).points(1).gate();
    turn1.judge.autoevals
      .closedQA(
        "输入是本轮标准工具调用 JSON。必须能从真实调用的入参、输出和状态确认：助手运行了非 dry-run 的完整 local experiment；运行结果是 6 个 eval、5 passed、1 failed、0 errored；随后使用 NiceEval 的结果查看能力下钻了新增失败，而不是只读源码猜测。local 因预期中的 eval failed 返回失败状态不应判 N。缺任一项判 N。",
        { on: JSON.stringify(turn1.toolCalls) },
      )
      .points(3)
      .gate();
    turn1.judge.autoevals
      .closedQA(
        "只判断助手回复。必须准确说明：原有 5 道题没有覆盖该取消边界；新增后得到 5 passed、1 failed、0 errored；失败复现的是已经开始履约或出库的订单仍得到可取消答复；本轮只新增回归 eval、尚未修业务实现。缺任一项判 N。",
        { on: turn1.message },
      )
      .points(3)
      .gate();
    turn1.succeeded().points(1).gate();

    const evalFilesResult = await t.sandbox.runCommand("find", [
      "evals/policy",
      "-type",
      "f",
      "-name",
      "*.eval.ts",
      "-print",
    ]);
    if (evalFilesResult.exitCode !== 0) {
      throw new Error(evalFilesResult.stderr || evalFilesResult.stdout);
    }
    const evalFiles = evalFilesResult.stdout
      .split("\n")
      .map((file) => file.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    const newEvalFiles = evalFiles.filter(
      (file) => !EXISTING_EVALS.includes(file as (typeof EXISTING_EVALS)[number]),
    );
    t.check(
      evalFiles.length === 6 && newEvalFiles.length === 1,
      isTrue("恰好新增一条会被 local 选中的 policy eval"),
    )
      .points(2)
      .gate()
      .stopOnFailure();

    const newEvalPath = newEvalFiles[0]!;
    const newEvalSource = await t.sandbox.readText(newEvalPath);
    t.judge.autoevals
      .closedQA(
        "这份源码是否是一条非空、可执行的 NiceEval 回归 eval：它向 policy agent 提问已经开始履约或已经出库的订单是否还能取消，并用 gate 级断言拒绝当前错误的“仍可取消”行为、要求明确的不可取消语义；不能通过 skip、弱到无意义的断言、硬编码恒真值或改 experiment 来伪造失败。API 写法只需符合该项目安装的 NiceEval 版本。",
        { on: newEvalSource },
      )
      .points(3)
      .gate();
    t.sandbox.fileChanged(newEvalPath).points(1);

    const candidateVersion = String(t.flags.candidateVersion);
    const fullRerunRule = candidateVersion.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：业务源码不进入 eval fingerprint，工具调用证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行）；裸跑后携入旧结果不算复验。";
    const turn2 = await t.send("现在修业务实现，保留这条回归 eval，再全量确认一次。");

    turn2.calledTool("shell", { status: "completed" }).points(1).gate();
    turn2.judge.autoevals
      .closedQA(
        `输入是本轮标准工具调用 JSON。必须能从真实调用的入参、输出和状态确认：修改后执行了完整 local experiment，并实际得到 6 passed、0 failed、0 errored。${fullRerunRule} 缺任一项判 N。`,
        { on: JSON.stringify(turn2.toolCalls) },
      )
      .points(3)
      .gate();
    turn2.judge.autoevals
      .closedQA(
        "只判断助手回复。必须准确说明修的是业务实现而不是削弱或删除回归 eval；最终共 6 个 eval，6 passed、0 failed、0 errored；并说明已经覆盖“履约前可以取消、履约开始或出库后不可取消”的边界。缺任一项判 N。",
        { on: turn2.message },
      )
      .points(3)
      .gate();

    t.check(
      (await t.sandbox.readText(newEvalPath)) === newEvalSource,
      isTrue("修复轮原样保留新增的回归 eval"),
    )
      .points(2)
      .gate();
    const cancellationBehaviorTest = await t.sandbox.runCommand("node", [
      "--input-type=module",
      "-e",
      [
        'const { answerPolicyQuestion } = await import("./src/policy.ts");',
        'const before = answerPolicyQuestion("Can I cancel my order before fulfillment starts?");',
        'const shipped = answerPolicyQuestion("My order has already shipped. Can I cancel it?");',
        'const fulfilling = answerPolicyQuestion("Fulfillment has started. Can this order be canceled?");',
        'if (before !== "Orders may be canceled before fulfillment begins.") throw new Error(`before: ${before}`);',
        'if (shipped !== "Orders cannot be canceled after fulfillment begins.") throw new Error(`shipped: ${shipped}`);',
        'if (fulfilling !== "Orders cannot be canceled after fulfillment begins.") throw new Error(`fulfilling: ${fulfilling}`);',
      ].join("\n"),
    ]);
    t.check(cancellationBehaviorTest, commandSucceeded()).points(3).gate();
    turn2.succeeded().points(1).gate();
  },
});
