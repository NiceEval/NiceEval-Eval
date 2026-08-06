/**
 * 评估adapter（软分，不 gate）：agent 写的 adapter 有没有真联上被测系统。
 *
 * 只信 agent 自装的 CLI，不自己找/读 result.json——跑了几次不是这层关心的事（适配 live 系统
 * 的成本、稳不稳定各不相同，agent 跑几次都合理，不该被断言锁死），这里只看跑没跑通。
 * `niceeval show` 显示的 verdict 是 passed / failed 就说明请求真发出去、回应真回来，连不上会
 * 是 errored。起被测系统很重且波动大（见 lib/target-app-env.ts），所以只作软分计量、不 gate。
 *
 * 只被 db-gpt / gpt-researcher 两条 eval 调用。理由是**起被测系统的代价**，不是「任务没要求」
 * ——「真跑一次」本来就写在 INIT.md 的完成清单里（Actually run it once and get it green），
 * 五条路径都适用。但 Letta / Skyvern / OpenHands 要起的东西太重也太飘（Letta 要起服务、
 * Skyvern 还要拉浏览器、OpenHands 要起 app_server + sandbox 内的 agent server），断言它跑通
 * 测到的是环境波动而不是文档效果，所以那三条只保留产出质量层（judge 读源码，见
 * ./quality-criteria.ts——五条路径都有那层，与这里的活联通性不互斥：那边判「写出来的评估
 * 成不成立」，这边判「真联上了没」）。
 *
 * 本文件三个考项，按「拿什么当事实」分：evalAdapter 判跑起来的事实（联上了没，两条轻路径），
 * evalExecutionEvidence 判落盘结果的事实（响应映射成事件流了没，五条路径），
 * evalAdapterPractice 判源码的事实（send 写没写成文档教的样子，五条自写 adapter 的路径）。
 *
 * 写法约定：判定一律用官方断言词汇，不发明领域 API；取证一律「一条命令或一个文件」。
 */

import type { ScoreTestContext } from "niceeval";
import { commandSucceeded, satisfies } from "niceeval/expect";
import { locateInstallRoot } from "./eval-install.ts";
import { readAgentFiles } from "./fixture.ts";

/**
 * 评估执行取证（纯加分，1 分）：adapter 是否真把被测系统的响应映射成了标准事件流。
 *
 * 不用 judge 读 adapter 源码判「协议对不对」——链路真通没通，`niceeval show --execution`
 * 一条命令就能取证：不带范围 = 当前 Scope 全部 attempt 逐节展开执行树，事件流里的助手
 * 消息按角色大写渲染成 `ASSISTANT` 节点。执行树里有 ASSISTANT，就说明 agent 写的 send
 * 真收到了回应并映射成了消息事件；adapter 没写对/没跑过/只跑出 errored 的，执行树里
 * 不会有任何 assistant 消息。五条接入路径都调（与 evalAdapter 不同——那个要起被测系统、
 * 只有两条轻路径调；这条只读已落盘的结果，谁都能调）。
 *
 * 写法约定同文件头：只信 agent 自装的 CLI，取证一条命令，判定紧跟一条 t.check 配 matcher。
 */
export async function evalExecutionEvidence(t: ScoreTestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  const execution = await sandbox.runShell(`npx --no-install niceeval show --execution 2>&1`, { cwd: at });

  await t.group("评估执行取证", async () => {
    t.check(
      execution.stdout,
      satisfies(
        (s) => /^\s*ASSISTANT\b/m.test(s as string),
        "show --execution 的执行树里有 ASSISTANT 消息（adapter 真把被测系统的响应映射成了事件流）",
      ),
    ).points(1);
  });
}

/**
 * 评估adapter最佳实践（纯加分，每条 1 分）：send 写没写成文档教的那个样子。
 *
 * 与 evalAdapter / evalExecutionEvidence 的分工：那两条判「链路通没通」（跑起来的事实），
 * 这条判「写法讲不讲究」（源码的事实）——链路通了也可能是一个写死 URL、吞掉 signal、
 * 只吐一条最终文本的 send，那种 adapter 换个环境就得重写、断言面也只剩文本。
 *
 * 判据全部逐字来自候选自己发的文档，一条对一条，不自己发明标准：
 * - 写 send 的三条贯穿原则（write-send.mdx 开头）：连用户前端在用的接口、只手写 transport、
 *   运行反馈走 ctx 不写终端；
 * - 七步里每步各留下的痕迹：`ctx.model` 转发（第一步）、`ctx.session` 续接（第二步）、
 *   官方转换器/事件映射（第四步）；
 * - 从零接入页的两条架构硬规则：不做进程内直调、静态配置走工厂参数不读 `process.env`。
 *
 * 为什么全用 grep 不用 judge：这七条问的都是「源码里有没有这个东西」，是存在性事实，
 * 机器验得了的就不发给 judge（同 ./eval-sandbox.ts 头注的分工）。judge 只判 grep 不动的
 * 语义（见 ./quality-criteria.ts 的四维 eval 设计）。
 *
 * **纯加分，没有一条是 gate，也不预期任何一条路径挣满**：多轮续接、工具事件映射这些
 * 取决于被测接口给不给得出（无状态单轮接口没有会话可续、只回最终答案的接口没有过程可映射），
 * 挣不到不代表 agent 写错了，只代表这次接入没走到那一档。分数横向比的是同一条路径在不同
 * 候选版本上的读数，不是路径之间比高低。
 *
 * 五条自写 adapter 的接入路径都调（只读源码，不碰被测系统，所以不像 evalAdapter 那样
 * 只限两条轻路径）；sandbox 路径（express-coding-agent）不调——那条用内置 agents，
 * 没有手写 send 可判。
 */
export async function evalAdapterPractice(t: ScoreTestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // 一条命令取回 agent 手写的 adapter：按新旧两代 define*Agent 认人，不按目录约定认——文档说
  // adapter 放 `agents/*.ts`「或用户项目里约定的目录」，按路径找会漏掉放别处的。
  const source = await readAgentFiles(
    sandbox,
    at,
    `grep -rlE 'define(Direct|Sandbox)?Agent' --include='*.ts' . --exclude-dir=node_modules`,
  );
  // satisfies() 的 predicate 参数固定收 unknown（见 niceeval/expect），七条判据共用这一个收窄。
  const src = (v: unknown) => v as string;

  await t.group("评估adapter最佳实践", async () => {
    // 「不做进程内直调」：就算被测系统和评估在同一台机器上，也要像前端用户那样走传输层。
    // 本仓五条路径的宿主都是 Python，物理上没法进程内直调——这条因此是地板分而不是难分，
    // 它兜的是「adapter 里根本没有请求、回复是编的/写死的」这种退化。
    t.check(
      source,
      satisfies(
        (s) => /\bfetch\s*\(|WebSocket|axios|https?\.request\s*\(|EventSource|node-fetch|undici/.test(src(s)),
        "send 里有真实的传输层调用（HTTP / WS 客户端），不是进程内直调或写死回复",
      ),
    ).points(1);

    // 第一步就该转发的 `ctx.signal`：运行器的超时与取消挂在它上面。不挂的 adapter 在
    // 超时时不会真的断开请求，attempt 被判超时了它还在后台跑。
    t.check(
      source,
      satisfies((s) => /ctx\.signal/.test(src(s)), "把 ctx.signal 挂到了发出的请求上（运行器的超时与取消真能中断）"),
    ).points(1);

    // 同样是第一步：experiment 的 model 经 ctx.model 到 send。收尾自检里明写的一条——
    // 「Experiment 里声明的 model / flags 确实被 Adapter 消费」，没消费就是死配置。
    t.check(
      source,
      satisfies((s) => /ctx\.model/.test(src(s)), "转发了 ctx.model（experiment 声明的模型不是没人读的死配置）"),
    ).points(1);

    // 「静态配置走 adapter 工厂参数」：URL / 鉴权进工厂参数，换环境（本地 / 预发 / 生产）
    // 只改实验文件里的一行，adapter 一行不动。
    // 只判正面、不判「有没有读 process.env」：文档两处口径不一致——从零接入页写「配置走工厂
    // 参数，不写死、不读 process.env」，而官方 tier1 示例的 adapter 恰恰是
    // `process.env.X ?? "http://127.0.0.1:…"`。照示例写的 agent 不该被扣，所以这条只在
    // 真写成工厂时给分：工厂是文档里更进一步的那一档，挣到才加分。
    t.check(
      source,
      satisfies(
        (s) => /(return|=>)\s*define(Direct|Sandbox)?Agent\s*\(/.test(src(s)),
        "静态配置走工厂参数（工厂函数返回 define*Agent，换环境只改实验文件一行）",
      ),
    ).points(1);

    // 第二步：接上 ctx.session 才有多轮与 t.newSession() 的会话隔离。接口无状态单轮时
    // 挣不到，属于「这次接入没走到那一档」，不是错——所以纯加分。
    t.check(
      source,
      satisfies((s) => /ctx\.session/.test(src(s)), "接上了 ctx.session（多轮续接 / 会话隔离，不是每轮一场新对话）"),
    ).points(1);

    // 第三条贯穿原则：运行反馈走 ctx，不直接写终端。两半都要——用了 progress/diagnostic，
    // 且没有 console.log / process.stdout（后者会串进运行器的实时输出）。
    t.check(
      source,
      satisfies(
        (s) =>
          /ctx\.(progress|diagnostic)\s*\(/.test(src(s)) &&
          !/console\.(log|error|warn|info)|process\.std(out|err)/.test(src(s)),
        "运行反馈走 ctx.progress / ctx.diagnostic，没有 console.log / 直写 stdout",
      ),
    ).points(1);

    // 第四步：把过程也归一进标准事件流——官方转换器（标准形状零映射）或手写 action.called /
    // thinking 映射。只吐一条最终文本的 send 也能跑绿，但工具族断言整族用不了。
    t.check(
      source,
      satisfies(
        (s) =>
          /\b(turnFrom(ChatCompletion|Responses|AiSdk)|create(ClaudeSdkEventStream|PiAgentEventStream|CodexThreadEventStream)|from(ChatCompletion|Responses|AiSdk|ClaudeSdkMessages|PiAgentEvents|CodexThreadEvents))\s*\(|deltaStream\s*\(|driveFrameStream\s*\(|uiMessageStreamAgent\s*\(/.test(
            src(s),
          ) || /["']action\.called["']|["']thinking["']|["']input\.requested["']/.test(src(s)),
        "过程也归一进了事件流（官方转换器，或手写 action.called / thinking 映射），不是只映射最终文本",
      ),
    ).points(1);
  });
}

/**
 * 评估adapter（软分，不 gate）：agent 写的 adapter 有没有真联上被测系统。
 * 见文件头注：只信 agent 自装的 CLI，不判跑了几次，只被两条 install eval 调用。
 */
export async function evalAdapter(t: ScoreTestContext): Promise<void> {
  const sandbox = t.sandbox;
  const at = (await locateInstallRoot(sandbox)) ?? ".";

  // 自装 CLI 能不能把跑出来的结果显示出来。show 没有 --output 这类 profile flag（两形态契约:
  // 不加 flag = 人读文本,非 TTY 自动降级为无框纯文本;--json 是机器面）,gate:show 尚未落地
  // --json,这里先用不带 flag 的默认人读文本;--json 落地后可把下面的字符串判定升级为结构化
  // 字段校验。
  const show = await sandbox.runShell(`npx --no-install niceeval show 2>&1`, { cwd: at });

  await t.group("评估adapter", async () => {
    t.check(show, commandSucceeded().atLeast(1));
    // 只要正向证据（出现 passed/failed = 请求真出去、回应真回来），不再排斥 errored 字样：
    // 「第一次跑挂、修好再跑通」是文件头明说合理的路径，历史里留着 errored 行不该连坐。
    // 连不上被测系统的 agent 本来就产不出任何 passed/failed。
    t.check(
      show.stdout,
      satisfies(
        (s) => /\b(passed|failed)\b/i.test(s as string),
        "niceeval show 显示的 verdict 有 passed/failed（真联上了被测系统；从没联上只会有 errored）",
      ).atLeast(1),
    );
  });
}
