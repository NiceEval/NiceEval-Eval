import { defineScoreEval } from "niceeval";
import { commandSucceeded, equals, isTrue } from "niceeval/expect";
import { listWorkspaceFiles, readFiles, turnEvidence } from "../support.ts";

const EXISTING_EVALS = [
  "evals/policy/exchange.eval.ts",
  "evals/policy/privacy.eval.ts",
  "evals/policy/refund.eval.ts",
  "evals/policy/shipping.eval.ts",
  "evals/policy/warranty.eval.ts",
] as const;

const SOURCE_FILES = ["src/policies.ts", "src/policy.ts"] as const;
const SOURCE_FILE_SET: ReadonlySet<string> = new Set(SOURCE_FILES);

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
    const startingFiles = await listWorkspaceFiles(t.sandbox);

    const version = String(t.flags.candidateVersion);
    const immutableFiles = startingFiles.filter((file) => !SOURCE_FILE_SET.has(file));
    const immutableBefore = await readFiles(t.sandbox, immutableFiles);
    const sourceBefore = await readFiles(t.sandbox, SOURCE_FILES);

    const reproductionCommandStart = t.o11y.shellCommands.length;
    const reproduction = await t.send(
      "客户报告：订单已经进入履约或出库后，policy agent 仍说可以取消。先把这个问题补成一条新的回归 eval，并在完整 local experiment 里实际跑出失败；暂时不要修业务实现。",
    );
    const reproductionCommands = t.o11y.shellCommands.slice(reproductionCommandStart);

    reproduction.judge.autoevals
      .closedQA(
        "输入是一份宿主侧证据 JSON，包含本轮助手原始回复和本轮真实 shell 命令。必须同时满足：命令证据显示助手确实运行了非 dry-run 的 local experiment，并针对新失败查看了 NiceEval 结果或 attempt 证据，而不是只读源码后猜测；回复准确说明原有 5 道题没有覆盖该问题、新增后共 6 道且结果为 5 passed、1 failed、0 errored；准确指出失败复现的是已经开始履约或出库的订单仍得到可取消答复；明确表示本轮只新增回归 eval、尚未修业务实现。命令失败码 1 可以是预期的 eval failed，不应据此判定没有运行。缺任一项判 N。",
        {
          on: turnEvidence(version, reproduction.message, reproductionCommands),
        },
      )
      .points(4)
      .gate();
    reproduction.succeeded().points(1).gate();

    const listed = await t.sandbox.runCommand("find", [
      "evals/policy",
      "-type",
      "f",
      "-name",
      "*.eval.ts",
      "-print",
    ]);
    if (listed.exitCode !== 0) throw new Error(listed.stderr || listed.stdout);
    const evalFiles = listed.stdout
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

    const immutableAfterReproduction = await readFiles(t.sandbox, immutableFiles);
    const sourceAfterReproduction = await readFiles(t.sandbox, SOURCE_FILES);
    t.check(
      immutableAfterReproduction.every((content, index) => content === immutableBefore[index]) &&
        sourceAfterReproduction.every((content, index) => content === sourceBefore[index]),
      isTrue("复现轮只新增回归 eval，没有改既有 eval、实验、配置、文档或业务实现"),
    )
      .points(2)
      .gate();

    const fullRerunRule = version.startsWith("0.9.")
      ? "候选是 0.9.x：修复后重新执行完整 local experiment 即可，不要求使用该版本没有的 rerun flag。"
      : "候选是 0.12+：业务源码不进入 eval fingerprint，命令证据必须体现强制全量重新执行（通常是 --rerun all，或语义等价的清理后全量运行）；裸跑后携入旧结果不算复验。";
    const repairCommandStart = t.o11y.shellCommands.length;
    const repair = await t.send("现在修业务实现，保留这条回归 eval，再全量确认一次。");
    const repairCommands = t.o11y.shellCommands.slice(repairCommandStart);

    repair.judge.autoevals
      .closedQA(
        `输入是一份宿主侧证据 JSON，包含候选版本、本轮助手原始回复和本轮真实 shell 命令。必须同时满足：助手修的是业务实现而不是削弱或删除回归 eval；命令证据显示修改后真实执行了完整 local experiment 且最终命令成功；准确汇报最终共 6 个 eval，6 passed、0 failed、0 errored；说明已覆盖“履约前可以取消、履约开始或出库后不可取消”的边界。${fullRerunRule} 缺任一项判 N。`,
        {
          on: turnEvidence(version, repair.message, repairCommands),
        },
      )
      .points(4)
      .gate();

    const immutableAfterRepair = await readFiles(t.sandbox, immutableFiles);
    const sourceAfterRepair = await readFiles(t.sandbox, SOURCE_FILES);
    t.check(
      immutableAfterRepair.every((content, index) => content === immutableBefore[index]) &&
        (await t.sandbox.readText(newEvalPath)) === newEvalSource,
      isTrue("修复轮保留回归 eval，且既有 eval、实验、配置和文档均未被篡改"),
    )
      .points(2)
      .gate();
    const finalFiles = await listWorkspaceFiles(t.sandbox);
    t.check(finalFiles, equals([...startingFiles, newEvalPath].sort()))
      .points(2)
      .gate();
    t.check(
      sourceAfterRepair.some((content, index) => content !== sourceBefore[index]),
      isTrue("业务实现发生了实际修改"),
    )
      .points(1)
      .gate();

    const probe = await t.sandbox.runCommand("node", [
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
    t.check(probe, commandSucceeded()).points(3).gate();
    repair.succeeded().points(1).gate();
  },
});
