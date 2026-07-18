/**
 * install eval 的公共骨架。
 *
 * 三个 fixture 的差别只是「宿主项目长什么样、该读哪几页文档、核心用例是什么」，
 * 三层评分的逻辑完全相同。把评分逻辑收在这里，fixture 就只剩数据，
 * 新增一条接入路径 = 加一个 spec，不用再抄一遍断言。
 */

import { defineEval } from "niceeval";
import { excludes, isFalse, isTrue, satisfies } from "niceeval/expect";
import { SANDBOX_CANDIDATE_PATH, SANDBOX_INIT_DOC_PATH } from "./candidate.ts";
import { collectMechanismFacts } from "./mechanism.ts";
import { bundledPagesTouched, fellBackToOnlineDocs, routedTo, touchedIndex } from "./routing.ts";

export interface InstallFixtureSpec {
  /** 一句话描述这条接入路径 */
  description: string;
  /** fixture 宿主项目的 git 仓库地址（公开只读 clone） */
  repoUrl: string;
  /** 锁定的 tag（某次具体的大版本发布），固定住被测宿主的行为，不随上游新提交漂移 */
  ref: string;
  /**
   * 仓库体积过大时，只 sparse-checkout 排除这些顶层目录（如文档站、图片素材）。
   * 省略 = 整个仓库都要，适合体积不大的宿主。
   */
  excludeDirs?: string[];
  /**
   * 宿主自带的前端/资源目录（如内嵌的 TS 前端）。产出质量层用 readSourceFiles 找
   * agent 写的 niceeval 代码时会一并跳过这些目录，避免和宿主自己的源码混在一起。
   */
  hostSourceDirs?: string[];
  /**
   * 这道题的合格文档落点（相对包根），任意一页命中即算路由正确。
   * 出题依据是 INIT.md 第 2 步的判断分支——不同宿主形态该落到不同页面。
   */
  expectedPages: string[];
  /** 宿主项目的核心用例，进 rubric：eval 输入必须贴着它写，而不是「你好」式占位 */
  coreUseCase: string;
  /** 被测系统的真实传输方式，进 rubric：adapter 必须走它，不能进程内直调 */
  transport: string;
}

const DEFAULT_SOURCE_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];

/**
 * 把 fixture 锁定的 tag clone 进沙箱工作区。
 *
 * 直接对着一个真实开源仓库跑，而不是签入静态快照：宿主是谁的行为跑分随时可核对
 * （对着同一个 ref 重新 clone 得到同样的文件），但也意味着体积可能很大——
 * `excludeDirs` 用 sparse-checkout 剪掉体积大又与「装 niceeval」无关的目录。
 *
 * clone 完立刻删 `.git`：宿主自带的历史与 niceeval 自己的 git 基线是两回事，
 * 留着它只会带来歧义，不带来任何断言用得上的信息。
 */
function cloneScript(spec: InstallFixtureSpec): string {
  if (!spec.excludeDirs?.length) {
    return `set -e
git clone --quiet --depth 1 --branch '${spec.ref}' --single-branch '${spec.repoUrl}' .
rm -rf .git`;
  }

  const sparsePattern = ["/*", ...spec.excludeDirs.map((d) => `!/${d}/`)].join("\n");
  return `set -e
git init -q
git remote add origin '${spec.repoUrl}'
git sparse-checkout init --no-cone
cat > .git/info/sparse-checkout <<'EOF'
${sparsePattern}
EOF
git fetch --quiet --depth 1 --filter=blob:none origin 'refs/tags/${spec.ref}'
git checkout --quiet FETCH_HEAD
rm -rf .git`;
}

async function cloneFixture(
  sandbox: { runShell: (script: string) => Promise<{ exitCode: number; stdout: string; stderr: string }> },
  spec: InstallFixtureSpec,
): Promise<void> {
  const result = await sandbox.runShell(cloneScript(spec));
  if (result.exitCode !== 0) {
    throw new Error(
      `clone fixture ${spec.repoUrl}@${spec.ref} failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
    );
  }
}

/** 安装指令。两个对照组的差异只有一处：有没有安装前引导文档。 */
function buildTask(spec: InstallFixtureSpec, withInitDoc: boolean): string {
  const shared = `这个仓库是一个已经在跑的项目。请把 niceeval 接入它，最后跑通一次实验。

候选 niceeval 包已经放在沙箱里：${SANDBOX_CANDIDATE_PATH}
必须从这个本地 tarball 安装（不要从 npm registry 装其它版本），因为本次要验证的就是这个构建。

这个环境里没有另一个人替你启动被测应用。需要它跑起来才能验证时，你自己在 shell 里
把它起到后台即可——但不要把「启动被测进程」这件事写进 adapter 代码。`;

  if (withInitDoc) {
    return `${shared}

安装引导文档在 ${SANDBOX_INIT_DOC_PATH}，先读它，然后按它说的做。`;
  }

  return `${shared}

自己判断该怎么装、该写哪些文件。`;
}

export function defineInstallEval(spec: InstallFixtureSpec) {
  return defineEval({
    description: spec.description,
    async test(t) {
      const withInitDoc = t.flags.initDoc !== false;

      // 起始文件：锁定 tag 的真实宿主项目。agent 之后改动的文件才会进 diff。
      await cloneFixture(t.sandbox as never, spec);

      const turn = await t.send(buildTask(spec, withInitDoc));

      // ── 第一层：机制层（gate）。安装链的客观事实。 ──────────────────
      const facts = await collectMechanismFacts(t.sandbox as never);

      await t.group("机制层", async () => {
        t.check(facts.layout.found, isTrue("niceeval.config.ts 存在").gate());
        t.check(
          facts.resolvesToCandidate,
          isTrue(`依赖解析到候选包（实际：${facts.installedVersion ?? "未安装"}）`).gate(),
        );
        t.check(facts.hasManagedBlock, isTrue("AGENTS.md / CLAUDE.md 里有托管指引区块").gate());
        t.check(facts.evalFileCount, satisfies((n) => (n as number) >= 1, "至少写出一条 eval").gate());
        t.check(
          facts.experimentFileCount,
          satisfies((n) => (n as number) >= 1, "至少写出一个 experiment").gate(),
        );
        t.check(
          facts.listExitCode,
          satisfies((c) => c === 0, "niceeval list 退出码为 0").gate(),
        );
        t.check(
          facts.discoveredEvalCount,
          satisfies((n) => (n as number) >= 1, "niceeval 能发现 agent 写出的 eval").gate(),
        );
        // 非 TS 宿主可以没有 tsconfig，这时不判失败——有 tsconfig 才要求它是干净的
        if (facts.typecheckErrorCount !== null) {
          t.check(
            facts.typecheckErrorCount,
            satisfies((n) => n === 0, "agent 写的代码 typecheck 干净").gate(),
          );
        }
        // compare-models 是 INIT.md 明确要求的默认组织方式，但宿主接口不支持选模型时
        // 允许退化成单实验，所以这里是软分不是 gate
        t.check(facts.hasCompareGroup, isTrue("按 compare-models 实验组组织").atLeast(1));
        t.check(facts.producedResults, isTrue("真的跑出过一次结果（.niceeval 有落盘）").atLeast(1));
      });

      // ── 第二层：产出质量层（rubric / judge）。三件套符不符合公开文档声明的契约。 ──
      const src = await t.sandbox.readSourceFiles({
        extensions: ["ts"],
        // 宿主自带的前端源码（如内嵌的 TS 前端）也会被 readSourceFiles 扫到；
        // 排除掉，避免下面的启发式误把宿主自己的代码当成 agent 写的 adapter/eval。
        ignoreDirs: [...DEFAULT_SOURCE_IGNORE_DIRS, ...(spec.hostSourceDirs ?? [])],
      });
      // adapter 的落点没有强制约定（INIT.md 说 agents/*.ts「或仓库既有惯例」），
      // 所以先按路径找，找不到再按内容找 defineAgent 的调用点
      const adapterSource =
        src.find((f) => /agents?\//.test(f.path))?.content ??
        src.fileMatching(/defineAgent|defineSandboxAgent|uiMessageStreamAgent/)?.content ??
        "";
      const evalSource = src.find((f) => /\.eval\.ts$/.test(f.path))?.content ?? "";

      await t.group("产出质量层", async () => {
        // 两条架构硬规则是客观的，用精确断言而不是 judge
        t.check(
          adapterSource,
          excludes(/from\s+["']\.\.?\/(?!.*niceeval).*\/(app|server|index|routes)/, {
            stripComments: true,
          }).atLeast(1),
        );
        t.check(
          adapterSource,
          excludes(/\b(spawn|exec|execa|child_process)\b/, { stripComments: true }).atLeast(1),
        );
        t.check(adapterSource, excludes(/process\.env\./, { stripComments: true }).atLeast(1));

        // 契约里「贴不贴真实功能」没法用正则判，交给 judge
        t.judge.autoevals
          .closedQA(
            `这段 eval 代码是否针对下面这个被测系统的真实核心用例编写？
被测系统：${spec.coreUseCase}
合格标准：eval 的输入是一个该系统真实会遇到的请求，断言检查的是该请求应该得到的具体结果。
不合格：输入是 "hello" / "你好" / "test" 这类与业务无关的占位内容，或断言只有 t.succeeded() 而没有任何内容断言。`,
            { on: evalSource },
          )
          .atLeast(0.7);

        t.judge.autoevals
          .closedQA(
            `这段 adapter 代码是否通过 ${spec.transport} 与被测系统通信，而不是在进程内直接 import 被测系统的函数？
合格：用 fetch / HTTP 请求等真实传输方式，被测系统的地址与鉴权来自工厂参数。
不合格：直接 import 应用代码后调用其函数，或在 adapter 内部启动被测进程。`,
            { on: adapterSource },
          )
          .atLeast(0.7);
      });

      // ── 第三层：路由层（计量，不 gate）。文档到底起没起作用。 ──────────
      const touched = bundledPagesTouched(t.events);

      await t.group("路由层", async () => {
        t.check(
          touchedIndex(t.events),
          isTrue(`以随包 INDEX.md 为路由入口（实际读到：${touched.join(", ") || "无"}）`).atLeast(1),
        );
        t.check(
          routedTo(t.events, spec.expectedPages),
          isTrue(`读到与宿主形态匹配的页面（期望其一：${spec.expectedPages.join(" | ")}）`).atLeast(1),
        );
        t.check(
          fellBackToOnlineDocs(t.events),
          isFalse("没有退回官网 / GitHub main 分支").atLeast(1),
        );
      });

      // 路由不理想时留一条永久记录，供事后按「哪一页没被读到」倒查文档。
      // 路由正常就不写——diagnostic 是用来记问题的，每次都写会把它变成噪声日志。
      if (!touchedIndex(t.events) || !routedTo(t.events, spec.expectedPages)) {
        t.diagnostic({
          code: "routing-miss",
          level: "warning",
          message: `路由未命中期望页面。实际读到：${touched.join(", ") || "无"}`,
          data: { touched, expected: spec.expectedPages, initDoc: withInitDoc },
        });
      }

      turn.succeeded();
    },
  });
}
