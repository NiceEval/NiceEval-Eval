/**
 * 评估sandbox创建（新考项）：agent 有没有把「评估要在隔离、可复现、启动快的环境里跑」
 * 落成**正确创建的** sandbox / 预制制品（E2B template / Docker image / Vercel snapshot）。
 *
 * 「要预制」本身是任务要求（罐头答复里明说，见调用方 eval），所以这层不考「想没想到预制」
 * 而考「创建得对不对」——对不对的标准全部来自 sandbox-providers.mdx，agent 读没读到、
 * 读懂没读懂那页，就在这几条判据上显影：
 *
 * - **机械取证**（一条命令 + 紧跟 t.check，写法约定同 installation.ts）：
 *   experiment/config 配没配 provider（gate——这条路径的题面就是沙箱评估，没配等于没做题）；
 *   用到的云/容器 provider SDK 有没有按文档「用哪个装哪个」进依赖；有没有预制制品定义
 *   （构建脚本 / Dockerfile / 快照脚本）。
 * - **judge 三维**（纯加分，各 1 分；closedQA 二值、一条只判一个点，机制同
 *   criteria/quality.ts 的头注）：预制分层 / 官方基线派生 / 制品引用版本化。这三点
 *   grep 不动语义——「稳定大件放进了哪一层」「是不是从官方基线继续派生」要读代码结构，
 *   是 judge 的活；「有没有」的存在性检查则坚决不给 judge，机器验。
 *
 * 判据里的三个维度对应文档的三条明文规则：
 * 1. 「稳定、体积大、每个 Attempt 都相同的内容应烘进 provider 制品，.setup() 只做薄薄一层
 *    动态配置和 fail-fast 检查」——预制分层。
 * 2. 「三个内置 provider 都能从官方基线继续派生，不必从空白环境装 Agent」「业务仓库不应
 *    复制 NICEEVAL 公共模板字符串」——官方基线派生。
 * 3. 「产物换一个版本化名字」「稳定 CI 要固定 release tag 或 digest，不要依赖会移动的
 *    latest」——制品引用版本化。
 *
 * 目前只被 sandbox 接入路径（express-coding-agent）调用；考项机制独立成文件，路径专属
 * 的事实与交互层由 case fixture 提供。
 */

import type { ScoreTestContext } from "niceeval";
import { isTrue, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./installation.ts";

/** 文档「用哪个装哪个」表：provider 工厂 → 必须进依赖的 SDK 包名。localSandbox 免装，不在表里。 */
const PROVIDER_SDK = [
  ["e2bSandbox", "e2b"],
  ["dockerImageSandbox", "dockerode"],
  ["dockerfileSandbox", "dockerode"],
  ["dockerComposeSandbox", "dockerode"],
  ["vercelSandbox", "@vercel/sandbox"],
] as const;

/** 每条 rubric 的公共开头：先框定材料，再强调「一次只判一个点」（机制同 criteria/quality.ts）。 */
const PREAMBLE =
  "背景：给你的材料是 agent 为「给一个真实仓库搭一套评 coding agent 的 niceeval 评估、" +
  "每个 attempt 在隔离沙箱里跑」写出的源码（.ts 带路径头，末尾可能附 Dockerfile）。" +
  "用户已要求评估环境要预制好、attempt 里别现装。\n" +
  "本条判据只判其中一个点，其它点由别的判据各自判——不要因为材料在别的点上有缺陷就给这一条判 N。\n";

/** sandbox/template 创建质量的三条独立判据。调用方各挂 Judge `.score(1)`，纯加分不 gate。 */
function buildSandboxRubrics(): { key: string; criteria: string }[] {
  return [
    {
      key: "预制分层",
      criteria:
        `${PREAMBLE}\n` +
        `判断：稳定且每个 attempt 都相同的内容（系统包、coding agent 的 CLI、宿主仓库的依赖安装、` +
        `工具链）是否定义在可复用的预制制品（E2B template 构建脚本 / Dockerfile / Vercel 快照脚本）里，` +
        `而 attempt 级的 setup 钩子只留动态薄层（按实验写小配置、fail-fast 检查、载入状态）？\n` +
        `不合格（N）：没有任何预制制品定义；或把这类稳定大件放进每个 attempt 都要跑的 ` +
        `.setup() 钩子 / eval 的 test() 开头现装。`,
    },
    {
      key: "官方基线派生",
      criteria:
        `${PREAMBLE}\n` +
        `判断：预制制品是否从官方基线继续派生，而不是从空白环境白手搭 coding agent 环境？\n` +
        `合格（Y）：E2B 用 e2bCodingAgentTemplate(...) 或 Template().fromTemplate(从 ` +
        `niceeval/sandbox/e2b-template 导入的公共模板常量)；Docker 用 FROM node:24-slim 或 ` +
        `niceeval/<agent> 公开镜像打底；Vercel 从官方 runtime 起机装好再拍快照。在基线之上追加` +
        `项目专属内容（宿主仓库依赖、额外工具）不影响判 Y。\n` +
        `不合格（N）：官方基线已提供 agent CLI 还从零自装一整套环境；或把 NICEEVAL 公共模板的` +
        `完整 ref 复制成自己维护的字符串常量（文档明说下游不应复制维护这些字符串，应从包导出的` +
        `常量取）。`,
    },
    {
      key: "制品引用版本化",
      criteria:
        `${PREAMBLE}\n` +
        `判断：预制制品的名字/引用是否版本化且不可变——构建产出带版本或日期的 alias/tag` +
        `（如 acme-evals:2026-07-13），experiment 引用固定的制品名 / release tag / snap_ id，` +
        `依赖变更时换新名字而不是原地覆盖？\n` +
        `不合格（N）：引用 latest 或无 tag 裸名；或材料里根本没有版本化的制品引用。` +
        `为本地先跑通而临时用 localSandbox() 的那格实验不算 N——本条只判预制制品那一路的引用。`,
    },
  ];
}

/**
 * 评估sandbox创建：机械取证（gate + 加分）+ judge 三维（纯加分）。见文件头注。
 *
 * `material` 由调用方传入（与产出质量层共用同一份 collectAgentSource 快照，不重复下载）；
 * Dockerfile 不是 .ts、那份材料收不进，这里就地补探——预制定义走 docker 路线时 judge 才看得见。
 */
export async function checkSandboxProvisioning(t: ScoreTestContext, opts: { material: string }): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // 探针只取证不判定。三条各是一条命令：用到的 provider 工厂、install root 的依赖表、
  // 预制制品定义的落点（构建脚本按内容 grep，Dockerfile 按文件名 find，合流去重）。
  const factories = (
    await sandbox.runShell(
      `grep -rhoE '\\b(e2b|docker(Image|file|Compose)|vercel|local)Sandbox\\(' --include='*.ts' . --exclude-dir=node_modules 2>/dev/null | sort -u`,
      { cwd: at },
    )
  ).stdout.trim();
  const deps = (
    await sandbox.runShell(
      `node -p "JSON.stringify({ ...require('./package.json').dependencies, ...require('./package.json').devDependencies })" 2>/dev/null`,
      { cwd: at },
    )
  ).stdout.trim();
  const prebake = (
    await sandbox.runShell(
      `{ grep -rlE 'Template\\.build|fromTemplate|e2bCodingAgentTemplate|\\.snapshot\\(' --include='*.ts' . --exclude-dir=node_modules; find . -maxdepth 3 -name 'Dockerfile*' -not -path './node_modules/*'; } 2>/dev/null | sort -u`,
      { cwd: at },
    )
  ).stdout.trim();
  const dockerfiles = (
    await sandbox.runShell(
      `find . -maxdepth 3 -name 'Dockerfile*' -not -path './node_modules/*' -exec sh -c 'echo "// $1"; cat "$1"' _ {} ';' 2>/dev/null`,
      { cwd: at },
    )
  ).stdout.trim();
  const material = dockerfiles ? `${opts.material}\n\n${dockerfiles}` : opts.material;
  const judgeInput = [...t.events]
    .reverse()
    .find((event) => event.type === "message" && event.role === "user")
    ?.text ?? "";
  const judgeMaterial = {
    input: judgeInput,
    output: material,
  };

  await t.group("评估sandbox创建", async () => {
    // gate：这条路径的题面就是「评估在隔离沙箱里跑」，experiment/config 没配任何 provider
    // 等于没做题——与「装成没装成」同级，红了 verdict 直接 failed。
    t.check(factories.length > 0, isTrue(`sandbox provider 已配置（实际检出：${factories || "无"}）`)).gate();

    // 文档明说 provider SDK 不随 niceeval 安装、「用哪个就装哪个」。挣这分要求真用了某个
    // 云/容器 provider 且它的 SDK 进了依赖——只用 localSandbox 的挣不到（它免装，这条判据
    // 对它无事实可验，不发空对空的分）。
    t.check(
      { factories, deps },
      satisfies("用到的云/容器 provider 的 SDK 按「用哪个装哪个」进了依赖", (v) => {
        const { factories: f, deps: d } = v as { factories: string; deps: string };
        const used = PROVIDER_SDK.filter(([factory]) => f.includes(factory));
        return used.length > 0 && used.every(([, pkg]) => d.includes(`"${pkg}"`));
      }),
    ).score(1).label("云/容器 provider SDK 依赖");

    // 存在预制制品定义（构建脚本 / Dockerfile / 快照脚本）。「要预制」是任务要求，这条只验
    // 存在性；定义得对不对由下面 judge 三维分别判。
    t.check(
      prebake.length > 0,
      isTrue(`存在预制制品定义（实际检出：${prebake || "无"}）`),
    ).score(1).label("存在预制制品定义");

    // judge 三维（纯加分）：预制分层 / 官方基线派生 / 制品引用版本化。
    for (const r of buildSandboxRubrics()) {
      t.judge.autoevals.closedQA(`【${r.key}】${r.criteria}`, judgeMaterial).score(1);
    }
  });
}
